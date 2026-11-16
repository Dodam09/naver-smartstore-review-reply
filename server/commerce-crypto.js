/**
 * 커머스 OAuth 토큰 암·복호화 (서버 전용).
 * 키 값은 절대 로그에 남기지 않는다.
 */
import crypto from 'node:crypto';

const PREFIX = 'v1';

function resolveKeyMaterial() {
  // 기존 .env를 바꾸지 않음. 테스트·운영은 COMMERCE_TOKEN_SECRET 권장.
  const raw =
    process.env.COMMERCE_TOKEN_SECRET ||
    process.env.SESSION_SECRET ||
    'dev-commerce-token-secret-not-for-production';
  return crypto.createHash('sha256').update(String(raw), 'utf8').digest();
}

export function encryptSecret(plain) {
  if (plain == null || plain === '') return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', resolveKeyMaterial(), iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}:${iv.toString('base64url')}:${tag.toString('base64url')}:${enc.toString('base64url')}`;
}

export function decryptSecret(blob) {
  const raw = String(blob || '');
  if (!raw) return '';
  const parts = raw.split(':');
  if (parts.length !== 4 || parts[0] !== PREFIX) {
    throw new Error('토큰 암호문 형식이 올바르지 않습니다.');
  }
  const iv = Buffer.from(parts[1], 'base64url');
  const tag = Buffer.from(parts[2], 'base64url');
  const data = Buffer.from(parts[3], 'base64url');
  const decipher = crypto.createDecipheriv('aes-256-gcm', resolveKeyMaterial(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

const SENSITIVE_KEY =
  /token|secret|authorization|password|refresh|access_token|client_secret/i;

/** 로그·API 응답용: 민감 필드를 제거·마스킹 */
export function redactSecrets(value, depth = 0) {
  if (depth > 6) return '[truncated]';
  if (value == null) return value;
  if (typeof value === 'string') {
    if (/^v1:[A-Za-z0-9_-]+:/.test(value)) return '[encrypted]';
    if (value.length > 20 && /^(eyJ|nwt_|live_|test_)/.test(value)) return '[redacted]';
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => redactSecrets(v, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (SENSITIVE_KEY.test(k)) {
        out[k] = v ? '[redacted]' : v;
        continue;
      }
      out[k] = redactSecrets(v, depth + 1);
    }
    return out;
  }
  return value;
}

export function assertNoSecretsInText(text) {
  const s = String(text || '');
  if (/access_token["']?\s*[:=]\s*["'][^"']+["']/i.test(s)) {
    throw new Error('응답에 access_token 평문이 포함되면 안 됩니다.');
  }
  if (/refresh_token["']?\s*[:=]\s*["'][^"']+["']/i.test(s)) {
    throw new Error('응답에 refresh_token 평문이 포함되면 안 됩니다.');
  }
}
