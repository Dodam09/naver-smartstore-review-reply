/**
 * 네이버 커머스 상품 API 클라이언트 (Phase 1: transport mock).
 * 실호출 기본 경로는 테스트에서 주입한다. 목록 + 채널 상세.
 * Phase 1-D: SALE+OUTOFSTOCK 기본, 308 리다이렉트, 401 GW.AUTHN 재발급 재시도.
 */
import { redactSecrets } from './commerce-crypto.js';

const SEARCH_URL_DEFAULT =
  'https://api.commerce.naver.com/external/v1/products/search';
const CHANNEL_PRODUCT_URL_DEFAULT =
  'https://api.commerce.naver.com/external/v2/products/channel-products';
const ALLOWED_API_HOST = 'api.commerce.naver.com';
const MAX_REDIRECTS = 3;

/** 목록 기본 상태: 판매중 + 품절 (삭제하지 않음) */
export const DEFAULT_PRODUCT_STATUS_TYPES = Object.freeze(['SALE', 'OUTOFSTOCK']);

let apiTransport = null;

export function setCommerceApiTransportForTests(fn) {
  apiTransport = typeof fn === 'function' ? fn : null;
}

export class CommerceApiError extends Error {
  constructor(message, { status = 500, code = 'COMMERCE_API', retryable = false, retryAfterMs = null } = {}) {
    super(message);
    this.name = 'CommerceApiError';
    this.status = status;
    this.code = code;
    this.retryable = retryable;
    this.retryAfterMs = retryAfterMs;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterMs(headers) {
  if (!headers) return null;
  const get = typeof headers.get === 'function' ? headers.get.bind(headers) : (k) => headers[k];
  const raw = get('retry-after') || get('Retry-After') || get('GNCP-GW-RateLimit-Remaining');
  // Prefer Retry-After seconds
  const retryAfter = get('retry-after') || get('Retry-After');
  if (retryAfter != null) {
    const n = Number(retryAfter);
    if (Number.isFinite(n) && n >= 0) return Math.min(n * 1000, 30_000);
  }
  return null;
}

async function defaultApiFetch(url, options = {}) {
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

function isCommerceApiMockMode() {
  return String(process.env.COMMERCE_OAUTH_MOCK || '').toLowerCase() === 'true';
}

async function callApi(req) {
  const method = req.method || 'POST';
  const opts = {
    method,
    headers: req.headers || {},
  };
  if (req.body != null && method !== 'GET' && method !== 'HEAD') {
    opts.body = req.body;
  }
  if (apiTransport) {
    return apiTransport(req.url, opts);
  }
  // 실행 제한: mock 모드에서는 커머스 상품 API 실호출 금지
  if (isCommerceApiMockMode()) {
    const url = String(req.url || '');
    if (/channel-products/i.test(url)) {
      return {
        ok: true,
        status: 200,
        data: {
          channelProductNo: 10001,
          originProductNo: 20001,
          statusType: 'SALE',
          channelProductName: 'mock-channel-product',
          originProduct: {
            name: 'mock-origin-product',
            detailContent: '<p>mock detail</p>',
          },
        },
      };
    }
    return {
      ok: true,
      status: 200,
      data: {
        contents: [
          { channelProductNo: 10001, name: 'mock-sale', statusType: 'SALE' },
          { channelProductNo: 10002, name: 'mock-oos', statusType: 'OUTOFSTOCK' },
        ],
      },
    };
  }
  return defaultApiFetch(req.url, opts);
}

function headerGet(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === 'function') return headers.get(name) || headers.get(name.toLowerCase());
  return headers[name] || headers[name.toLowerCase()] || headers[name.toUpperCase()] || null;
}

/**
 * 308/301/302 Location 검증 — api.commerce.naver.com HTTPS만 허용, 루프 방지.
 */
export function resolveCommerceRedirectUrl(currentUrl, locationHeader, { visited = new Set() } = {}) {
  const loc = String(locationHeader || '').trim();
  if (!loc) {
    const err = new CommerceApiError('리다이렉트 Location이 없습니다.', {
      status: 308,
      code: 'COMMERCE_REDIRECT_NO_LOCATION',
    });
    throw err;
  }
  let next;
  try {
    next = new URL(loc, currentUrl);
  } catch {
    const err = new CommerceApiError('리다이렉트 URL이 올바르지 않습니다.', {
      status: 308,
      code: 'COMMERCE_REDIRECT_BAD_URL',
    });
    throw err;
  }
  if (next.protocol !== 'https:') {
    const err = new CommerceApiError('HTTPS가 아닌 리다이렉트는 허용되지 않습니다.', {
      status: 308,
      code: 'COMMERCE_REDIRECT_INSECURE',
    });
    throw err;
  }
  if (next.hostname !== ALLOWED_API_HOST) {
    const err = new CommerceApiError('허용되지 않은 리다이렉트 호스트입니다.', {
      status: 308,
      code: 'COMMERCE_REDIRECT_HOST',
    });
    throw err;
  }
  const href = next.href;
  if (visited.has(href)) {
    const err = new CommerceApiError('리다이렉트 루프가 감지되었습니다.', {
      status: 308,
      code: 'COMMERCE_REDIRECT_LOOP',
    });
    throw err;
  }
  if (visited.size >= MAX_REDIRECTS) {
    const err = new CommerceApiError('리다이렉트 횟수 한도를 초과했습니다.', {
      status: 308,
      code: 'COMMERCE_REDIRECT_LIMIT',
    });
    throw err;
  }
  visited.add(href);
  return href;
}

function isGwAuthn(result) {
  return result?.status === 401 && String(result?.data?.code || '') === 'GW.AUTHN';
}

async function maybeRefreshTokenOnAuthn(result, ctx) {
  if (!isGwAuthn(result) || !ctx?.userId || ctx.authRetried) return null;
  const { reissueAccessTokenAfterAuthnFailure } = await import('./commerce-oauth.js');
  return reissueAccessTokenAfterAuthnFailure(ctx.userId, { storeId: ctx.storeId });
}

/**
 * 상품 목록 조회 (페이지 단위).
 * 기본 productStatusTypes = SALE + OUTOFSTOCK (품절 임의 삭제 없음).
 */
export async function searchCommerceProducts({
  accessToken,
  page = 1,
  size = 50,
  productStatusTypes = DEFAULT_PRODUCT_STATUS_TYPES,
  signal,
  userId,
  storeId,
} = {}) {
  if (!String(accessToken || '').trim()) {
    throw new CommerceApiError('accessToken이 필요합니다.', {
      status: 401,
      code: 'COMMERCE_NO_TOKEN',
    });
  }
  const pageNum = Math.max(1, Number(page) || 1);
  const pageSize = Math.min(500, Math.max(1, Number(size) || 50));
  const statuses = Array.isArray(productStatusTypes) && productStatusTypes.length
    ? productStatusTypes
    : [...DEFAULT_PRODUCT_STATUS_TYPES];
  const url = String(process.env.COMMERCE_PRODUCT_SEARCH_URL || SEARCH_URL_DEFAULT);
  const body = {
    page: pageNum,
    size: pageSize,
    productStatusTypes: statuses,
  };

  const maxRetries = Number(process.env.COMMERCE_API_MAX_RETRIES ?? 2);
  let token = accessToken;
  let authRetried = false;
  let lastErr;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    if (signal?.aborted) {
      const err = new Error('요청이 취소되었습니다.');
      err.name = 'AbortError';
      throw err;
    }

    const result = await callApi({
      url,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (result?.ok) {
      const data = result.data || {};
      const contents = Array.isArray(data.contents)
        ? data.contents
        : Array.isArray(data.data)
          ? data.data
          : Array.isArray(data.products)
            ? data.products
            : [];
      return {
        contents,
        page: pageNum,
        size: pageSize,
        productStatusTypes: statuses,
        totalElements: data.totalElements ?? data.total ?? contents.length,
        totalPages: data.totalPages,
        raw: redactSecrets(data),
      };
    }

    if (isGwAuthn(result) && userId && !authRetried) {
      token = await maybeRefreshTokenOnAuthn(result, { userId, storeId, authRetried });
      authRetried = true;
      attempt -= 1;
      continue;
    }

    const status = result?.status || 500;
    const code = result?.data?.code || 'COMMERCE_HTTP';
    const retryAfterMs = parseRetryAfterMs(result?.headers);
    const retryable = status === 429 || status === 503 || status === 502 || status === 504;
    lastErr = new CommerceApiError(
      status === 429
        ? '커머스 API 호출 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.'
        : code === 'GW.AUTHN'
          ? '커머스 인증이 만료되었습니다.'
          : '상품 목록 조회에 실패했습니다.',
      {
        status,
        code: status === 429 ? 'GW.RATE_LIMIT' : code,
        retryable,
        retryAfterMs,
      }
    );

    if (retryable && attempt < maxRetries) {
      const wait = retryAfterMs != null ? retryAfterMs : Math.min(8000, 400 * 2 ** attempt);
      await sleep(wait);
      continue;
    }
    throw lastErr;
  }

  throw lastErr;
}

/** fixture 상품 → 내부 정규화 */
export function normalizeCommerceListItem(item = {}) {
  const channelProductNo = String(
    item.channelProductNo ?? item.channel_product_no ?? item.productNo ?? item.id ?? ''
  ).replace(/[^\d]/g, '');
  const originProductNo = String(
    item.originProductNo ?? item.origin_product_no ?? item.originProductId ?? ''
  ).replace(/[^\d]/g, '');
  const name = String(
    item.name ?? item.productName ?? item.originProduct?.name ?? item.channelProductName ?? ''
  ).trim();
  const status = String(
    item.statusType ?? item.status ?? item.productStatusType ?? ''
  ).trim();
  return {
    channelProductNo,
    originProductNo,
    productName: name.slice(0, 200),
    status: status.slice(0, 40),
  };
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function pickAttrText(...candidates) {
  for (const c of candidates) {
    if (c == null) continue;
    if (typeof c === 'string' && c.trim()) return c.trim();
    if (typeof c === 'object') {
      const t = c.content || c.value || c.name || c.text || c.code;
      if (typeof t === 'string' && t.trim()) return t.trim();
    }
  }
  return '';
}

/**
 * 채널 상품 단건 조회 (문의 상품 on-demand).
 * @returns {{ channelProductNo, originProductNo, status, knowledgeFields, presentFields, raw }}
 */
export async function getCommerceChannelProduct({
  accessToken,
  channelProductNo,
  signal,
  userId,
  storeId,
} = {}) {
  const no = String(channelProductNo || '').replace(/[^\d]/g, '');
  if (!String(accessToken || '').trim()) {
    throw new CommerceApiError('accessToken이 필요합니다.', {
      status: 401,
      code: 'COMMERCE_NO_TOKEN',
    });
  }
  if (!no) {
    throw new CommerceApiError('channelProductNo가 필요합니다.', {
      status: 400,
      code: 'COMMERCE_BAD_PRODUCT_NO',
    });
  }

  const base = String(
    process.env.COMMERCE_CHANNEL_PRODUCT_URL || CHANNEL_PRODUCT_URL_DEFAULT
  ).replace(/\/$/, '');
  let url = `${base}/${encodeURIComponent(no)}`;
  const maxRetries = Number(process.env.COMMERCE_API_MAX_RETRIES ?? 2);
  let token = accessToken;
  let authRetried = false;
  let lastErr;
  const visited = new Set([url]);

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    if (signal?.aborted) {
      const err = new Error('요청이 취소되었습니다.');
      err.name = 'AbortError';
      throw err;
    }

    const result = await callApi({
      url,
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    });

    // 308 PERMANENT_REDIRECT (및 301/302) — 허용 호스트만 수동 추적
    if (result?.status === 308 || result?.status === 301 || result?.status === 302) {
      const loc = headerGet(result.headers, 'location') || result?.data?.location;
      url = resolveCommerceRedirectUrl(url, loc, { visited });
      attempt -= 1;
      continue;
    }

    if (result?.ok) {
      const data = result.data || {};
      return {
        ...normalizeCommerceChannelProduct(data, no),
        raw: redactSecrets(data),
        finalUrl: url,
      };
    }

    if (isGwAuthn(result) && userId && !authRetried) {
      token = await maybeRefreshTokenOnAuthn(result, { userId, storeId, authRetried });
      authRetried = true;
      attempt -= 1;
      continue;
    }

    const status = result?.status || 500;
    const code = result?.data?.code || 'COMMERCE_HTTP';
    const retryAfterMs = parseRetryAfterMs(result?.headers);
    const retryable = status === 429 || status === 503 || status === 502 || status === 504;
    lastErr = new CommerceApiError(
      status === 404
        ? '커머스에서 상품을 찾을 수 없습니다.'
        : status === 429
          ? '커머스 API 호출 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.'
          : code === 'GW.AUTHN'
            ? '커머스 인증이 만료되었습니다.'
            : '상품 상세 조회에 실패했습니다.',
      {
        status,
        code: status === 429 ? 'GW.RATE_LIMIT' : code,
        retryable,
        retryAfterMs,
      }
    );

    if (retryable && attempt < maxRetries) {
      const wait = retryAfterMs != null ? retryAfterMs : Math.min(8000, 400 * 2 ** attempt);
      await sleep(wait);
      continue;
    }
    throw lastErr;
  }

  throw lastErr;
}

/**
 * 응답에 실제로 존재하는 필드만 KB 후보로 매핑. 추측·임의 생성 금지.
 * stockQuantity·salePrice 등은 확정 근거 필드에 넣지 않음.
 */
export function normalizeCommerceChannelProduct(data = {}, fallbackChannelNo = '') {
  const origin = data.originProduct && typeof data.originProduct === 'object' ? data.originProduct : {};
  const channelProductNo = String(
    data.channelProductNo ?? data.channel_product_no ?? fallbackChannelNo ?? ''
  ).replace(/[^\d]/g, '');
  const originProductNo = String(
    data.originProductNo ?? data.origin_product_no ?? origin.originProductNo ?? origin.id ?? ''
  ).replace(/[^\d]/g, '');
  const status = String(
    data.statusType ?? data.channelProductStatusType ?? data.status ?? origin.statusType ?? ''
  ).trim();

  const presentFields = [];
  const knowledgeFields = {};

  const name = String(origin.name ?? data.channelProductName ?? data.name ?? '').trim();
  if (name) {
    knowledgeFields.productName = name.slice(0, 200);
    presentFields.push('product_name');
  }

  if (Object.prototype.hasOwnProperty.call(origin, 'detailContent') || Object.prototype.hasOwnProperty.call(data, 'detailContent')) {
    const rawHtml = origin.detailContent ?? data.detailContent;
    if (rawHtml != null && String(rawHtml).trim()) {
      knowledgeFields.detailDescription = stripHtml(rawHtml).slice(0, 20000);
      presentFields.push('detail_description');
    }
  }

  const attr =
    (origin.detailAttribute && typeof origin.detailAttribute === 'object'
      ? origin.detailAttribute
      : null) ||
    (data.detailAttribute && typeof data.detailAttribute === 'object' ? data.detailAttribute : null);

  if (attr) {
    const specParts = [];
    const originArea = pickAttrText(attr.originArea, attr.originAreaContent);
    if (originArea) specParts.push(`원산지: ${originArea}`);
    const asInfo = pickAttrText(attr.afterServiceInfo, attr.afterServiceTelephoneNumber);
    if (asInfo) specParts.push(`A/S: ${asInfo}`);
    const manufacturer = pickAttrText(attr.manufacturerName, attr.manufacturer);
    if (manufacturer) specParts.push(`제조사: ${manufacturer}`);
    const model = pickAttrText(attr.modelName, attr.model);
    if (model) specParts.push(`모델: ${model}`);
    if (specParts.length) {
      knowledgeFields.specs = specParts.join('\n').slice(0, 8000);
      presentFields.push('specs');
    }

    const extraParts = [];
    const sellerCode = pickAttrText(attr.sellerCode, attr.sellerManagementCode);
    if (sellerCode) extraParts.push(`판매자코드: ${sellerCode}`);
    const brand = pickAttrText(attr.brandName, attr.brand);
    if (brand) extraParts.push(`브랜드: ${brand}`);
    if (extraParts.length) {
      knowledgeFields.extra = extraParts.join('\n').slice(0, 8000);
      presentFields.push('extra');
    }
  }

  // 재고·가격은 메타로만 기록(지식 본문 아님)
  const meta = {};
  if (data.stockQuantity != null || origin.stockQuantity != null) {
    meta.stockQuantity = data.stockQuantity ?? origin.stockQuantity;
  }
  if (data.salePrice != null || origin.salePrice != null) {
    meta.salePrice = data.salePrice ?? origin.salePrice;
  }

  return {
    channelProductNo,
    originProductNo,
    productName: knowledgeFields.productName || '',
    status: status.slice(0, 40),
    knowledgeFields,
    presentFields,
    meta,
  };
}
