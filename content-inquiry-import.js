/**
 * 판매자센터 상품문의 목록 API (GET /api/v3/contents/comments/pages)
 */
(function () {
  const INQUIRY_IMPORT_VERSION = 2;
  if (globalThis.__ssInquiryImportVersion !== INQUIRY_IMPORT_VERSION) {
    globalThis.__ssInquiryImportVersion = INQUIRY_IMPORT_VERSION;
    globalThis.__ssInquiryImportListener = false;
    globalThis.__ssInquiryImportLoaded = false;
  }

  if (!globalThis.__ssInquiryImportListener) {
    globalThis.__ssInquiryImportListener = true;
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message.type === 'SS_INQUIRY_PING') {
        sendResponse({ ok: true });
        return false;
      }

      if (message.type === 'SS_REVIEW_PING') {
        sendResponse({ ok: true });
        return false;
      }

      if (message.type === 'FETCH_INQUIRIES') {
        fetchInquiries(message.payload || {})
          .then((result) => sendResponse({ ok: true, ...result }))
          .catch((err) => sendResponse({ ok: false, error: err.message || String(err) }));
        return true;
      }

      if (message.type === 'FETCH_INQUIRY_REPLY_CATALOG') {
        fetchAnsweredInquiryCatalog(message.payload || {})
          .then((result) => sendResponse({ ok: true, ...result }))
          .catch((err) => sendResponse({ ok: false, error: err.message || String(err) }));
        return true;
      }
      return false;
    });
  }

  if (globalThis.__ssInquiryImportLoaded) return;
  globalThis.__ssInquiryImportLoaded = true;

  const DEFAULT_LIST_PATH = '/api/v3/contents/comments/pages';

  if (typeof clampLookupDays !== 'function') {
    globalThis.clampLookupDays = function clampLookupDaysFallback(days, options = {}) {
      const min = options.min ?? 0;
      const max = options.max ?? 365;
      const n = Number(days);
      if (!Number.isFinite(n)) return options.fallback ?? 7;
      return Math.max(min, Math.min(max, Math.floor(n)));
    };
  }

  if (typeof formatLookupDaysLabel !== 'function') {
    globalThis.formatLookupDaysLabel = function formatLookupDaysLabelFallback(days) {
      const d = clampLookupDays(days);
      if (d === 0) return '당일';
      if (d === 1) return '2일';
      if (d === 2) return '3일';
      if (d === 7) return '1주일';
      return `최근 ${d}일`;
    };
  }

  if (typeof buildInquiryLookupDateRange !== 'function') {
    globalThis.buildInquiryLookupDateRange = function buildInquiryLookupDateRangeFallback(days) {
      const clamped = clampLookupDays(days, { min: 0, max: 365, fallback: 7 });
      const now = new Date();
      const formatKst = (date, endOfDay) => {
        const parts = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Asia/Seoul',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).formatToParts(date);
        const y = parts.find((p) => p.type === 'year')?.value;
        const m = parts.find((p) => p.type === 'month')?.value;
        const dPart = parts.find((p) => p.type === 'day')?.value;
        const time = endOfDay ? '23:59:59.999' : '00:00:00.000';
        return `${y}-${m}-${dPart}T${time}+09:00`;
      };
      if (clamped === 0) {
        return { startDate: formatKst(now, false), endDate: formatKst(now, true) };
      }
      const from = new Date(now);
      from.setDate(from.getDate() - clamped);
      return { startDate: formatKst(from, false), endDate: formatKst(now, true) };
    };
  }

  async function fetchInquiries(options) {
    const maxDays = clampLookupDays(options.days, { min: 0, max: 365, fallback: 7 });
    const maxItems = Math.max(1, Math.min(200, Number(options.maxItems) || 100));
    const onlyUnanswered = options.onlyUnanswered !== false;
    const listBaseUrl = await resolveInquiryListUrl();
    const parsedRows = [];
    let totalScanned = 0;
    let page = 0;
    let hasMore = true;

    while (hasMore && parsedRows.length < maxItems && page < 20) {
      const { startDate, endDate } = buildDateRange(maxDays);
      const url = buildListUrl(listBaseUrl, {
        page,
        startDate,
        endDate,
        onlyUnanswered,
      });

      const json = await getJson(url);
      const contents = json?.contents || [];
      if (!Array.isArray(contents)) {
        throw new Error('문의 목록 형식을 인식하지 못했습니다.');
      }

      totalScanned += contents.length;

      for (const item of contents) {
        if (onlyUnanswered && !isUnansweredInquiry(item)) continue;

        const id = String(item.id ?? '').trim();
        const content = normalizeInquiryContent(item.commentContent || item.commentContentWithTags || '');
        if (!id || !content) continue;

        parsedRows.push({
          id,
          content,
          product: item.productName || item.contentsName || '',
          writer: item.maskedWriterId || item.writerIdNo || '',
          secret: !!item.secret,
          regDate: item.regDate || '',
        });

        if (parsedRows.length >= maxItems) break;
      }

      hasMore = contents.length >= getPageSize(url) && parsedRows.length < maxItems;
      page += 1;

      if (page === 1 && !contents.length) break;
    }

    if (!parsedRows.length) {
      throw new Error(
        onlyUnanswered
          ? `${formatLookupDaysLabel(maxDays)} 내 미답변 상품문의가 없습니다.`
          : `${formatLookupDaysLabel(maxDays)} 내 상품문의가 없습니다.`
      );
    }

    return {
      parsedRows,
      totalScanned,
      sourceLabel: `판매자센터 상품문의 (${formatLookupDaysLabel(maxDays)}${onlyUnanswered ? ' · 미답변' : ''})`,
      days: maxDays,
    };
  }

  async function fetchAnsweredInquiryCatalog(options) {
    const maxDays = clampLookupDays(options.days, { min: 0, max: 365, fallback: 7 });
    const maxItems = Math.max(10, Math.min(120, Number(options.maxItems) || 60));
    const listBaseUrl = await resolveInquiryListUrl();
    const catalog = [];
    const seenIds = new Set();
    let totalScanned = 0;
    let page = 0;
    let hasMore = true;

    while (hasMore && catalog.length < maxItems && page < 20) {
      const { startDate, endDate } = buildDateRange(maxDays);
      const url = buildListUrl(listBaseUrl, {
        page,
        startDate,
        endDate,
        onlyUnanswered: false,
        onlyAnswered: true,
      });

      const json = await getJson(url);
      const contents = json?.contents || [];
      if (!Array.isArray(contents)) {
        throw new Error('문의 목록 형식을 인식하지 못했습니다.');
      }

      totalScanned += contents.length;

      for (const item of contents) {
        if (!isAnsweredInquiry(item)) continue;

        const id = String(item.id ?? '').trim();
        const question = normalizeInquiryContent(
          item.commentContent || item.commentContentWithTags || ''
        );
        if (!id || !question) continue;
        if (seenIds.has(id)) continue;
        seenIds.add(id);

        const inlineAnswer = extractInlineSellerReply(item);
        catalog.push({
          id,
          question,
          content: question,
          answer: inlineAnswer || '',
          reply: inlineAnswer || '',
          hasAnswer: !!inlineAnswer,
          product: item.productName || item.contentsName || '',
          writer: item.maskedWriterId || item.writerIdNo || '',
          regDate: item.regDate || '',
        });

        if (catalog.length >= maxItems) break;
      }

      hasMore = contents.length >= getPageSize(url) && catalog.length < maxItems;
      page += 1;
      if (page === 1 && !contents.length) break;
    }

    await enrichCatalogAnswers(catalog, listBaseUrl);

    const withAnswer = catalog.filter((item) => item.hasAnswer);
    if (!withAnswer.length) {
      throw new Error(
        `${formatLookupDaysLabel(maxDays)} 내 답변 완료 상품문의를 찾지 못했습니다.\n` +
          '판매자센터 상품문의 페이지에서 답변 완료 목록을 연 뒤 다시 시도하세요.'
      );
    }

    return {
      catalog: withAnswer,
      totalScanned,
      withAnswerCount: withAnswer.length,
      days: maxDays,
    };
  }

  function isAnsweredInquiry(item) {
    if (!item || typeof item !== 'object') return false;
    if (item.sellerAnswer === true || item.sellerAnswer === 'true') return true;
    if (item.sellerAnswer === false || item.sellerAnswer === 'false') return false;
    return !!item.sellerAnswerDate;
  }

  function extractInlineSellerReply(item) {
    const candidates = [
      item.sellerCommentContent,
      item.sellerAnswerContent,
      item.answerContent,
      item.sellerComment?.commentContent,
      item.sellerComment?.unescapeCommentContent,
      item.sellerAnswer?.commentContent,
    ];
    for (const raw of candidates) {
      const text = normalizeInquiryContent(raw);
      if (text.length >= 4) return text;
    }
    return '';
  }

  async function enrichCatalogAnswers(catalog, listBaseUrl) {
    const pending = catalog.filter((entry) => !entry.hasAnswer);
    if (!pending.length) return;

    const origin = getOriginFromListUrl(listBaseUrl);
    let cursor = 0;
    const concurrency = 6;

    async function worker() {
      while (cursor < pending.length) {
        const entry = pending[cursor];
        cursor += 1;
        const answer = await fetchSellerReplyForComment(origin, entry.id);
        if (!answer) continue;
        entry.answer = answer;
        entry.reply = answer;
        entry.hasAnswer = true;
      }
    }

    await Promise.all(Array.from({ length: Math.min(concurrency, pending.length) }, () => worker()));
  }

  function getOriginFromListUrl(listBaseUrl) {
    try {
      return new URL(listBaseUrl).origin;
    } catch (_) {
      return location.origin;
    }
  }

  async function fetchSellerReplyForComment(origin, commentId) {
    const url = `${origin}/api/v3/contents/comments/${commentId}/replies`;
    try {
      const json = await getJson(url);
      return extractReplyFromPayload(json);
    } catch (_) {
      return '';
    }
  }

  function extractReplyFromPayload(json) {
    const lists = [
      json?.contents,
      json?.replies,
      json?.data?.contents,
      json?.data?.replies,
      Array.isArray(json) ? json : null,
    ].filter(Array.isArray);

    for (const list of lists) {
      for (const item of list) {
        const text = normalizeInquiryContent(
          item.commentContent ||
            item.unescapeCommentContent ||
            item.content ||
            item.commentContentWithTags ||
            ''
        );
        if (text.length >= 4) return text;
      }
    }
    return '';
  }

  function isUnansweredInquiry(item) {
    if (!item || typeof item !== 'object') return false;
    if (item.sellerAnswer === false || item.sellerAnswer === 'false') return true;
    if (item.sellerAnswer === true || item.sellerAnswer === 'true') return false;
    return !item.sellerAnswerDate;
  }

  function buildListUrl(baseUrl, options) {
    const params = new URLSearchParams({
      commentType: '',
      endDate: options.endDate,
      keyword: '',
      page: String(options.page || 0),
      range: '5',
      searchKeywordType: 'PRODUCT_NAME',
      sellerAnswer: options.onlyAnswered ? 'true' : options.onlyUnanswered ? 'false' : '',
      size: '50',
      startDate: options.startDate,
      totalCount: '0',
    });
    return `${baseUrl}?${params.toString()}`;
  }

  function getPageSize(url) {
    try {
      return Number(new URL(url).searchParams.get('size')) || 50;
    } catch (_) {
      return 50;
    }
  }

  function buildDateRange(days) {
    return buildInquiryLookupDateRange(days);
  }

  async function resolveInquiryListUrl() {
    const configured =
      typeof CONFIG !== 'undefined' && CONFIG.INQUIRY_LIST_URL
        ? String(CONFIG.INQUIRY_LIST_URL).trim()
        : '';
    if (configured) return stripQuery(configured);

    const captured = await readCapturedInquiryListBase();
    if (captured) return stripQuery(captured);

    const fromPerf = findInquiryListUrlFromPerformance();
    if (fromPerf) return stripQuery(fromPerf);

    return `${location.origin}${DEFAULT_LIST_PATH}`;
  }

  function stripQuery(url) {
    return String(url).split('?')[0];
  }

  function findInquiryListUrlFromPerformance() {
    const entries = performance.getEntriesByType('resource');
    for (let i = entries.length - 1; i >= 0; i--) {
      const name = entries[i].name || '';
      if (!name.includes('smartstore.naver.com')) continue;
      if (!name.includes('/comments/pages')) continue;
      return name;
    }
    return null;
  }

  function readCapturedInquiryListBase() {
    return new Promise((resolve) => {
      const handler = (event) => {
        if (event.source !== window || event.data?.type !== 'SS_INQUIRY_LIST_BASE') return;
        window.removeEventListener('message', handler);
        resolve(event.data.url || null);
      };
      window.addEventListener('message', handler);
      window.postMessage({ type: 'SS_INQUIRY_GET_LIST_BASE' }, '*');
      setTimeout(() => {
        window.removeEventListener('message', handler);
        resolve(null);
      }, 300);
    });
  }

  async function getJson(url) {
    const res = await fetch(url, {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });

    let json;
    try {
      json = await res.json();
    } catch (_) {
      throw new Error(`API 응답 파싱 실패 (${res.status})`);
    }

    if (!res.ok) {
      throw new Error(json?.message || `API 오류 (${res.status})`);
    }

    return json;
  }

  function formatKstIso(date, endOfDay) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);

    const y = parts.find((p) => p.type === 'year')?.value;
    const m = parts.find((p) => p.type === 'month')?.value;
    const d = parts.find((p) => p.type === 'day')?.value;
    const time = endOfDay ? '23:59:59.999' : '00:00:00.000';
    return `${y}-${m}-${d}T${time}+09:00`;
  }

  function normalizeInquiryContent(text) {
    return String(text ?? '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/\r\n/g, '\n')
      .trim();
  }
})();
