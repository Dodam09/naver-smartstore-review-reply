import crypto from 'node:crypto';

const KAKAO_REST_API_KEY = String(
  process.env.KAKAO_REST_API_KEY || process.env.KAKAO_CLIENT_ID || ''
).trim();
const KAKAO_CLIENT_SECRET = String(process.env.KAKAO_CLIENT_SECRET || '').trim();
const STATE_TTL_MS = 10 * 60 * 1000;

function resolveAppBaseUrl() {
  const explicit = String(process.env.APP_BASE_URL || '').trim().replace(/\/$/, '');
  if (explicit) return explicit;

  const railwayDomain = String(process.env.RAILWAY_PUBLIC_DOMAIN || '').trim();
  if (railwayDomain) return `https://${railwayDomain}`.replace(/\/$/, '');

  const port = process.env.PORT || 8787;
  return `http://127.0.0.1:${port}`;
}

function getStateSecret() {
  return KAKAO_CLIENT_SECRET || KAKAO_REST_API_KEY || 'kakao-oauth-state';
}

function encodePayload(payload) {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

function decodePayload(encoded) {
  return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
}

export function isKakaoConfigured() {
  return !!KAKAO_REST_API_KEY;
}

export function getKakaoRedirectUri() {
  const explicit = String(process.env.KAKAO_REDIRECT_URI || '').trim().replace(/\/$/, '');
  if (explicit) return explicit;
  return `${resolveAppBaseUrl()}/api/auth/kakao/callback`;
}

export function createOAuthState(source = 'web') {
  const payload = {
    source,
    t: Date.now(),
    n: crypto.randomBytes(8).toString('hex'),
  };
  const data = encodePayload(payload);
  const sig = crypto.createHmac('sha256', getStateSecret()).update(data).digest('base64url');
  return `${data}.${sig}`;
}

export function consumeOAuthState(state) {
  const raw = String(state || '');
  const dot = raw.lastIndexOf('.');
  if (dot <= 0) return null;

  const data = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  const expected = crypto.createHmac('sha256', getStateSecret()).update(data).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }

  try {
    const payload = decodePayload(data);
    if (Date.now() - payload.t > STATE_TTL_MS) return null;
    return { source: payload.source };
  } catch {
    return null;
  }
}

export function buildAuthorizeUrl(state) {
  const params = new URLSearchParams({
    client_id: KAKAO_REST_API_KEY,
    redirect_uri: getKakaoRedirectUri(),
    response_type: 'code',
    state,
  });
  return `https://kauth.kakao.com/oauth/authorize?${params.toString()}`;
}

export async function exchangeCodeForToken(code) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: KAKAO_REST_API_KEY,
    redirect_uri: getKakaoRedirectUri(),
    code: String(code || ''),
  });
  if (KAKAO_CLIENT_SECRET) {
    body.set('client_secret', KAKAO_CLIENT_SECRET);
  }

  const response = await fetch('https://kapi.kakao.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
    body,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    const code = data.error || '';
    const detail = data.error_description || data.error_code || '';
    if (code === 'invalid_client') {
      throw new Error('REST API 키 또는 Client Secret이 올바르지 않습니다. Railway 변수를 확인해 주세요.');
    }
    if (code === 'invalid_grant') {
      throw new Error(
        'Redirect URI가 일치하지 않거나 인증 코드가 만료되었습니다. 카카오 콘솔 Redirect URI를 확인해 주세요.'
      );
    }
    throw new Error(detail || code || '카카오 토큰 발급에 실패했습니다.');
  }
  return data;
}

export async function fetchKakaoUser(accessToken) {
  const response = await fetch('https://kapi.kakao.com/v2/user/me', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
    },
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.id) {
    const message = data.msg || data.error_description || '카카오 사용자 정보를 가져오지 못했습니다.';
    throw new Error(message);
  }
  return data;
}

export function buildKakaoSuccessUrl({ token, error }) {
  const base = `${resolveAppBaseUrl()}/kakao-success.html`;
  const params = new URLSearchParams();
  if (token) params.set('token', token);
  if (error) params.set('error', String(error));
  const query = params.toString();
  return query ? `${base}?${query}` : base;
}
