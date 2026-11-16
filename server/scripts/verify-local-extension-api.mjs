/**
 * 로컬 API가 확장 E2E에 필요한 인증·CORS·KB 엔드포인트를 제공하는지 검증.
 * 사용: node scripts/verify-local-extension-api.mjs
 */
import 'dotenv/config';

const BASE = String(process.env.BASE_URL || 'http://127.0.0.1:8787').replace(/\/$/, '');

async function req(pathname, { method = 'GET', token, body, origin } = {}) {
  const headers = {
    'Content-Type': 'application/json',
    Origin: origin || 'chrome-extension://local-e2e-test',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${pathname}`, {
    method,
    headers,
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  return { status: res.status, headers: res.headers, data };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  console.log('Checking', BASE);
  const health = await req('/health');
  assert(health.status === 200 && health.data?.ok, 'health 실패');
  assert(health.data.registrationOpen === true, 'ALLOW_REGISTRATION=true 필요');
  assert(health.data.geminiConfigured === true, 'GEMINI_API_KEY 필요');

  const opt = await fetch(`${BASE}/api/product-knowledge`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'chrome-extension://local-e2e-test',
      'Access-Control-Request-Method': 'PUT',
      'Access-Control-Request-Headers': 'authorization,content-type',
    },
  });
  assert(opt.status === 204 || opt.status === 200, `OPTIONS 실패: ${opt.status}`);
  const allow = String(opt.headers.get('access-control-allow-methods') || '');
  assert(/PUT/i.test(allow) && /DELETE/i.test(allow), `CORS methods 부족: ${allow}`);

  const email = `local-e2e-${Date.now()}@example.com`;
  const password = 'TestPass123!';
  const reg = await req('/api/auth/register', { method: 'POST', body: { email, password } });
  assert(reg.status === 201 || reg.status === 200, `register 실패: ${reg.status} ${reg.data?.error}`);
  const login = await req('/api/auth/login', { method: 'POST', body: { email, password } });
  assert(login.status === 200 && login.data?.token, `login 실패: ${JSON.stringify(login.data)}`);
  const token = login.data.token;

  const me = await req('/api/auth/me', { token });
  assert(me.status === 200 && me.data?.user?.id, 'auth/me 실패');

  const productNo = '8800111222333';
  const upsert = await req('/api/product-knowledge', {
    method: 'POST',
    token,
    body: { productNo, productName: '로컬E2E', specs: '스펙A', source: 'manual' },
  });
  assert(upsert.status === 200 && upsert.data?.item?.productNo === productNo, 'KB 저장 실패');

  const got = await req(`/api/product-knowledge/${productNo}`, { token });
  assert(got.status === 200 && /스펙A/.test(got.data?.item?.specs || ''), 'KB 조회 실패');

  const put = await req(`/api/product-knowledge/${productNo}`, {
    method: 'PUT',
    token,
    body: { productName: '로컬E2E수정', specs: '스펙B' },
  });
  assert(put.status === 200 && /스펙B/.test(put.data?.item?.specs || ''), 'KB 수정 실패');

  const pol = await req('/api/store-policies', {
    method: 'PUT',
    token,
    body: { shipping: '영업일 2일' },
  });
  assert(pol.status === 200, '정책 저장 실패');

  const del = await req(`/api/product-knowledge/${productNo}`, { method: 'DELETE', token });
  assert(del.status === 200 && del.data?.deleted === true, 'KB 삭제 실패');

  console.log('PASS local extension API readiness');
  console.log(JSON.stringify({ email, userId: me.data.user.id, api: BASE }, null, 2));
}

main().catch((err) => {
  console.error('FAIL', err.message || err);
  process.exit(1);
});
