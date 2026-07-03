import crypto from 'node:crypto';

const KAKAO_REST_API_KEY = String(
  process.env.KAKAO_REST_API_KEY || process.env.KAKAO_CLIENT_ID || ''
).trim();
const KAKAO_CLIENT_SECRET = String(process.env.KAKAO_CLIENT_SECRET || '').trim();

function resolveAppBaseUrl() {
  const explicit = String(process.env.APP_BASE_URL || '').trim().replace(/\/$/, '');
  if (explicit) return explicit;

  const railwayDomain = String(process.env.RAILWAY_PUBLIC_DOMAIN || '').trim();
  if (railwayDomain) return `https://${railwayDomain}`.replace(/\/$/, '');

  const port = process.env.PORT || 8787;
  return `http://127.0.0.1:${port}`;
}

const pendingStates = new Map();
const STATE_TTL_MS = 10 * 60 * 1000;

function cleanupExpiredStates() {
  const now = Date.now();
  for (const [state, entry] of pendingStates.entries()) {
    if (now - entry.createdAt > STATE_TTL_MS) {
      pendingStates.delete(state);
    }
  }
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
  cleanupExpiredStates();
  const state = crypto.randomBytes(16).toString('hex');
  pendingStates.set(state, { source, createdAt: Date.now() });
  return state;
}

export function consumeOAuthState(state) {
  cleanupExpiredStates();
  const entry = pendingStates.get(String(state || ''));
  if (!entry) return null;
  pendingStates.delete(String(state));
  if (Date.now() - entry.createdAt > STATE_TTL_MS) return null;
  return entry;
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
    const message = data.error_description || data.error || '카카오 토큰 발급에 실패했습니다.';
    throw new Error(message);
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
  if (error) params.set('error', error);
  const query = params.toString();
  return query ? `${base}?${query}` : base;
}
