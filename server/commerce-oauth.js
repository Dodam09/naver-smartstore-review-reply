/**
 * 네이버 커머스 OAuth2 Client Credentials (서버 전용).
 * 공식 문서: https://apicenter.commerce.naver.com/docs/auth
 * Phase 1-D: authorization_code / refresh_token / client_secret 평문 전송 제거.
 * 실토큰 발급·실호출은 테스트 transport mock으로만 검증한다.
 */
import bcrypt from 'bcryptjs';
import {
  clearCommerceOauthSecrets,
  getCommerceOauthConnection,
  upsertCommerceOauthConnection,
} from './db.js';
import { decryptSecret, encryptSecret, redactSecrets } from './commerce-crypto.js';
import { normalizeStoreId } from './knowledge-protect.js';

const TOKEN_URL_DEFAULT = 'https://api.commerce.naver.com/external/v1/oauth2/token';
/** 문서상 access token 유효 시간 기본(초) — 응답 expires_in 우선 */
const DEFAULT_EXPIRES_IN = 10_800;

let oauthTransport = null;

export function setCommerceOauthTransportForTests(fn) {
  oauthTransport = typeof fn === 'function' ? fn : null;
}

function clientCredentials() {
  return {
    clientId: String(process.env.COMMERCE_CLIENT_ID || '').trim(),
    clientSecret: String(process.env.COMMERCE_CLIENT_SECRET || '').trim(),
  };
}

export function isCommerceOauthConfigured() {
  const { clientId, clientSecret } = clientCredentials();
  if (String(process.env.COMMERCE_OAUTH_MOCK || '').toLowerCase() === 'true') return true;
  return !!(clientId && clientSecret && !/YOUR_|CHANGE|HERE/i.test(clientId));
}

async function defaultOauthFetch(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text.slice(0, 200) };
  }
  return { ok: res.ok, status: res.status, data, headers: res.headers };
}

function isOauthMockMode() {
  return String(process.env.COMMERCE_OAUTH_MOCK || '').toLowerCase() === 'true';
}

async function callOauthTransport(req) {
  if (oauthTransport) {
    return oauthTransport(req.url, {
      method: req.method || 'POST',
      headers: req.headers || {},
      body: req.body,
    });
  }
  // 실행 제한: mock 모드에서는 네이버 토큰 URL 실호출 금지
  if (isOauthMockMode()) {
    return {
      ok: true,
      status: 200,
      data: {
        access_token: `mock-access-${Date.now()}`,
        expires_in: 3600,
        token_type: 'Bearer',
      },
    };
  }
  return defaultOauthFetch(req.url, {
    method: req.method || 'POST',
    headers: req.headers || {},
    body: req.body,
  });
}

function nowIso() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function expiresAtFromSeconds(expiresIn) {
  const sec = Number(expiresIn);
  if (!Number.isFinite(sec) || sec <= 0) return null;
  return new Date(Date.now() + sec * 1000).toISOString();
}

/**
 * 공식 전자서명 (Docs > 인증 > 전자서명 / Node.js 예시와 동일).
 * password = `${clientId}_${timestamp}`
 * hashed = bcrypt.hashSync(password, clientSecret)  // salt = client_secret
 * return Buffer.from(hashed, 'utf-8').toString('base64')  // standard Base64
 */
export function generateCommerceClientSecretSign(clientId, clientSecret, timestamp) {
  const id = String(clientId || '');
  const secret = String(clientSecret || '');
  const ts = String(timestamp);
  if (!id) {
    const err = new Error('client_id가 필요합니다.');
    err.code = 'OAUTH_CLIENT_ID_REQUIRED';
    throw err;
  }
  if (!secret) {
    const err = new Error('client_secret이 필요합니다.');
    err.code = 'OAUTH_CLIENT_SECRET_REQUIRED';
    throw err;
  }
  if (!ts || !/^\d+$/.test(ts)) {
    const err = new Error('timestamp(ms)가 필요합니다.');
    err.code = 'OAUTH_TIMESTAMP_REQUIRED';
    throw err;
  }
  const password = `${id}_${ts}`;
  const hashed = bcrypt.hashSync(password, secret);
  return Buffer.from(hashed, 'utf-8').toString('base64');
}

/**
 * 토큰 요청 body 구성. type=SELF이면 account_id를 절대 포함하지 않음 (2025.05 공지).
 * client_secret 평문 키를 넣지 않음.
 */
export function buildCommerceTokenRequestParams({
  clientId,
  clientSecret,
  timestamp = Date.now(),
  type = 'SELF',
  accountId = '',
} = {}) {
  const grantType = 'client_credentials';
  const authType = String(type || 'SELF').toUpperCase();
  if (authType !== 'SELF' && authType !== 'SELLER') {
    const err = new Error('type은 SELF 또는 SELLER만 허용됩니다.');
    err.code = 'OAUTH_TYPE_INVALID';
    throw err;
  }
  const ts = String(timestamp);
  const sign = generateCommerceClientSecretSign(clientId, clientSecret, ts);
  const params = new URLSearchParams();
  params.set('client_id', String(clientId));
  params.set('timestamp', ts);
  params.set('client_secret_sign', sign);
  params.set('grant_type', grantType);
  params.set('type', authType);
  if (authType === 'SELLER') {
    const aid = String(accountId || '').trim();
    if (!aid) {
      const err = new Error('type=SELLER일 때 account_id가 필요합니다.');
      err.code = 'OAUTH_ACCOUNT_ID_REQUIRED';
      throw err;
    }
    params.set('account_id', aid);
  }
  // SELF: account_id 미포함 (공지 필수)
  return params;
}

/** 요청 문자열에 client_secret 평문 키가 없는지 검사 (테스트·가드) */
export function assertNoPlainClientSecretInTokenBody(body, clientSecret) {
  const s = String(body || '');
  if (/client_secret=/.test(s) && !/client_secret_sign=/.test(s.replace(/client_secret_sign=[^&]*/g, ''))) {
    // client_secret= as distinct key (not client_secret_sign)
  }
  if (/(?:^|&)client_secret=/.test(s)) {
    throw new Error('토큰 요청에 client_secret 평문을 넣으면 안 됩니다.');
  }
  const secret = String(clientSecret || '');
  if (secret && s.includes(secret)) {
    throw new Error('토큰 요청에 client_secret 평문 값이 포함되면 안 됩니다.');
  }
}

export function getCommerceOauthStatus(userId, { storeId } = {}) {
  const conn = getCommerceOauthConnection(userId, { storeId });
  if (!conn) {
  return {
    configured: isCommerceOauthConfigured(),
    status: 'disconnected',
    storeId: normalizeStoreId(storeId),
    connected: false,
    expiresAt: null,
    accountId: '',
    clientId: '',
    hasAccessToken: false,
    hasClientSecret: false,
    authType: 'SELF',
    lastError: '',
  };
  }
  let status = conn.status;
  if (status === 'connected' && conn.expiresAt) {
    const exp = Date.parse(conn.expiresAt);
    if (Number.isFinite(exp) && exp <= Date.now()) status = 'expired';
  }
  return {
    configured: isCommerceOauthConfigured(),
    status,
    storeId: conn.storeId,
    connected: status === 'connected',
    expiresAt: conn.expiresAt,
    accountId: conn.accountId,
    clientId: conn.clientId || '',
    hasAccessToken: !!conn.hasAccessToken,
    hasClientSecret: !!conn.hasClientSecret,
    authType: 'SELF',
    lastError: conn.lastError || '',
    connectedAt: conn.connectedAt,
  };
}

function resolveConnectCredentials(userId, scope, options = {}) {
  const env = clientCredentials();
  const existing = getCommerceOauthConnection(userId, { storeId: scope, includeSecrets: true });
  const bodyId = String(options.clientId || options.client_id || '').trim();
  const bodySecret = String(options.clientSecret || options.client_secret || '').trim();

  let id = bodyId || existing?.clientId || env.clientId;
  let secret = bodySecret;
  if (!secret && existing?.clientSecretEnc) {
    try {
      secret = decryptSecret(existing.clientSecretEnc);
    } catch {
      secret = '';
    }
  }
  if (!secret) secret = env.clientSecret;
  if (
    !secret &&
    String(process.env.COMMERCE_OAUTH_MOCK || '').toLowerCase() === 'true' &&
    !bodyId
  ) {
    // mock + 자격증명 미입력: 문서 예시 salt로 구조 테스트만
    id = id || 'mock-client-id';
    secret = '$2a$10$abcdefghijklmnopqrstuv';
  }
  return { id, secret, fromBody: !!(bodyId || bodySecret) };
}

/**
 * Client Credentials로 토큰 발급·재발급 후 연결 저장.
 * @param {{ storeId?, type?, accountId?, timestamp? }} options
 */
export async function issueCommerceAccessToken(userId, options = {}) {
  const scope = normalizeStoreId(options.storeId);
  const authType = String(options.type || process.env.COMMERCE_OAUTH_TYPE || 'SELF').toUpperCase();
  const { id, secret } = resolveConnectCredentials(userId, scope, options);

  if (!id || !secret) {
    const err = new Error('커머스 Client ID/Secret이 필요합니다.');
    err.code = 'OAUTH_NOT_CONFIGURED';
    throw err;
  }

  const timestamp = options.timestamp != null ? options.timestamp : Date.now();
  const params = buildCommerceTokenRequestParams({
    clientId: id,
    clientSecret: secret,
    timestamp,
    type: authType,
    accountId: options.accountId || '',
  });
  const body = params.toString();
  assertNoPlainClientSecretInTokenBody(body, secret);

  const tokenUrl = String(process.env.COMMERCE_OAUTH_TOKEN_URL || TOKEN_URL_DEFAULT);
  let result;
  try {
    result = await callOauthTransport({
      url: tokenUrl,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body,
    });
  } catch {
    upsertCommerceOauthConnection(userId, {
      storeId: scope,
      status: 'disconnected',
      lastError: '토큰 발급 네트워크 오류',
      oauthState: '',
    });
    const e = new Error('토큰 발급에 실패했습니다.');
    e.code = 'OAUTH_TOKEN_NETWORK';
    throw e;
  }

  if (!result?.ok || !result.data?.access_token) {
    upsertCommerceOauthConnection(userId, {
      storeId: scope,
      status: 'disconnected',
      lastError: `토큰 발급 실패 (${result?.status || 0})`,
      oauthState: '',
    });
    const e = new Error('토큰 발급에 실패했습니다.');
    e.code = 'OAUTH_TOKEN_REJECTED';
    e.status = result?.status || 400;
    throw e;
  }

  const data = result.data;
  const access = String(data.access_token || '').trim();
  const expiresIn = data.expires_in != null ? data.expires_in : DEFAULT_EXPIRES_IN;
  // Client Secret은 서버 DB에만 암호화 보관(재발급). 응답·확장 storage에 넣지 않음.
  upsertCommerceOauthConnection(userId, {
    storeId: scope,
    status: 'connected',
    accountId: String(data.account_id || options.accountId || '').slice(0, 120),
    clientId: id,
    clientSecretEnc: encryptSecret(secret),
    accessTokenEnc: encryptSecret(access),
    refreshTokenEnc: '',
    tokenType: String(data.token_type || 'Bearer').slice(0, 40),
    expiresAt: expiresAtFromSeconds(expiresIn),
    scope: String(data.scope || '').slice(0, 500),
    oauthState: '',
    lastError: '',
    connectedAt: nowIso(),
    disconnectedAt: null,
  });
  return getCommerceOauthStatus(userId, { storeId: scope });
}

/** 연결 = 토큰 발급 (인가 코드 흐름 없음) */
export async function connectCommerceOauth(userId, options = {}) {
  return issueCommerceAccessToken(userId, options);
}

/** 만료·재발급: client_credentials 재호출 (저장된 서버 암호문 또는 요청 body) */
export async function reissueCommerceAccessToken(userId, options = {}) {
  return issueCommerceAccessToken(userId, options);
}

/** @deprecated Phase 1-D: refresh_token 제거 — reissue로 위임 */
export async function refreshCommerceOauth(userId, opts = {}) {
  return reissueCommerceAccessToken(userId, opts);
}

export function disconnectCommerceOauth(userId, { storeId } = {}) {
  const scope = normalizeStoreId(storeId);
  clearCommerceOauthSecrets(userId, { storeId: scope, status: 'disconnected', lastError: '' });
  return getCommerceOauthStatus(userId, { storeId: scope });
}

/**
 * 유효 access token 평문 반환 (호출부에서만 짧게 사용, 로그 금지).
 */
export async function getValidAccessToken(userId, { storeId, skewMs = 60_000 } = {}) {
  const scope = normalizeStoreId(storeId);
  let conn = getCommerceOauthConnection(userId, { storeId: scope, includeSecrets: true });
  if (!conn || !conn.accessTokenEnc) {
    const err = new Error('커머스 API가 연결되어 있지 않습니다.');
    err.code = 'OAUTH_NOT_CONNECTED';
    throw err;
  }

  const exp = conn.expiresAt ? Date.parse(conn.expiresAt) : NaN;
  const needsReissue = Number.isFinite(exp) && exp <= Date.now() + skewMs;
  if (needsReissue || conn.status === 'expired') {
    await reissueCommerceAccessToken(userId, { storeId: scope });
    conn = getCommerceOauthConnection(userId, { storeId: scope, includeSecrets: true });
  }

  if (!conn?.accessTokenEnc) {
    const err = new Error('액세스 토큰이 없습니다.');
    err.code = 'OAUTH_NOT_CONNECTED';
    throw err;
  }

  try {
    return decryptSecret(conn.accessTokenEnc);
  } catch {
    const err = new Error('액세스 토큰을 읽을 수 없습니다.');
    err.code = 'OAUTH_DECRYPT_FAILED';
    throw err;
  }
}

/**
 * API 401 + GW.AUTHN 시 토큰 재발급 후 access token 반환.
 */
export async function reissueAccessTokenAfterAuthnFailure(userId, { storeId } = {}) {
  await reissueCommerceAccessToken(userId, { storeId });
  return getValidAccessToken(userId, { storeId, skewMs: 0 });
}

export function safeOauthLog(payload) {
  return redactSecrets(payload);
}

/** 레거시 호환: begin/complete는 제거됨을 명시 */
export function beginCommerceOauth() {
  const err = new Error(
    '인가 코드 OAuth는 제거되었습니다. connectCommerceOauth(client_credentials)를 사용하세요.'
  );
  err.code = 'OAUTH_LEGACY_REMOVED';
  throw err;
}

export async function completeCommerceOauth() {
  return beginCommerceOauth();
}
