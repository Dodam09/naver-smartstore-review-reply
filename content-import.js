/**
 * 판매자센터 리뷰 search API
 */
(function () {
  if (globalThis.__ssReviewImportLoaded) return;
  globalThis.__ssReviewImportLoaded = true;

  const MAX_CATALOG_DAYS = 730;

  injectPageHook();

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'SS_REVIEW_PING') {
      sendResponse({ ok: true });
      return false;
    }

    if (message.type === 'FETCH_REVIEWS') {
      fetchReviews(message.payload || {})
        .then((result) => sendResponse({ ok: true, ...result }))
        .catch((err) => sendResponse({ ok: false, error: err.message || String(err) }));
      return true;
    }

    if (message.type === 'FETCH_SELLER_REPLY_SAMPLES') {
      fetchSellerReplySamples(message.payload || {})
        .then((result) => sendResponse({ ok: true, ...result }))
        .catch((err) => sendResponse({ ok: false, error: err.message || String(err) }));
      return true;
    }

    if (message.type === 'FETCH_SELLER_REPLY_CATALOG') {
      fetchSellerReplyCatalog(message.payload || {})
        .then((result) => sendResponse({ ok: true, ...result }))
        .catch((err) => sendResponse({ ok: false, error: err.message || String(err) }));
      return true;
    }

    return false;
  });

  function injectPageHook() {
    if (document.documentElement.dataset.ssPageHook) return;
    document.documentElement.dataset.ssPageHook = '1';

    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('page-hook.js');
    script.onload = () => script.remove();
    (document.head || document.documentElement).appendChild(script);
  }

  async function fetchAllReviewItems(days, options = {}) {
    const searchUrl = await resolveSearchUrl();
    const allItems = [];
    let page = 0;
    let hasMore = true;

    while (hasMore) {
      const payload = buildSearchPayload(page, days, options);
      const json = await postSearch(searchUrl, payload);
      const contents = json?.contents || json?.data?.contents || [];

      if (!Array.isArray(contents)) {
        throw new Error('리뷰 목록 형식을 인식하지 못했습니다.');
      }

      allItems.push(...contents);
      hasMore = contents.length >= payload.size;
      page += 1;
      if (page > 20) break;
    }

    return allItems;
  }

  async function fetchReviews(options) {
    const days = clampLookupDays(options.days, { min: 0, max: 90, fallback: 7 });
    const onlyUnreplied = options.onlyUnreplied !== false;
    const allItems = await fetchAllReviewItems(days, { onlyUnreplied });

    let skippedReplied = 0;
    let skippedEmpty = 0;
    const parsedRows = [];

    for (const item of allItems) {
      const content = normalizeReviewContent(item.reviewContent || '');
      const id = String(item.id ?? '').trim();

      if (!id || !content) {
        skippedEmpty++;
        continue;
      }

      if (onlyUnreplied && itemHasSellerComment(item)) {
        skippedReplied++;
        continue;
      }

      parsedRows.push({
        id,
        content,
        rating: item.reviewScore != null ? String(item.reviewScore) : '',
        product: item.productName || '',
        reviewType: mapReviewType(item.reviewType),
        option: '',
        writer: item.maskedWriterId || item.writerIdNo || '',
      });
    }

    if (!parsedRows.length) {
      throw new Error(
        `답글 대상 리뷰가 없습니다. (답글완료 ${skippedReplied}건 제외, 내용없음 ${skippedEmpty}건)`
      );
    }

    return {
      parsedRows,
      skippedReplied,
      skippedEmpty,
      totalFetched: allItems.length,
      sourceLabel: `판매자센터 (${formatLookupDaysLabel(days)})`,
    };
  }

  function clampCatalogDays(days, fallback = 365) {
    return clampLookupDays(days, { min: 0, max: MAX_CATALOG_DAYS, fallback });
  }

  /** 네이버 search API는 한 번에 약 90일까지만 허용하는 경우가 많음 */
  const MAX_SEARCH_WINDOW_DAYS = 90;

  function buildLookbackWindows(maxLookbackDays, windowDays = MAX_SEARCH_WINDOW_DAYS) {
    const total = clampLookupDays(maxLookbackDays, { min: 0, max: MAX_CATALOG_DAYS, fallback: 0 });
    if (total === 0) {
      return [{ startDaysAgo: 0, endDaysAgo: 0, windowDays: 0 }];
    }

    const windows = [];
    let covered = 0;

    while (covered < total) {
      const size = Math.min(windowDays, total - covered);
      windows.push({
        startDaysAgo: covered + size,
        endDaysAgo: covered,
        windowDays: size,
      });
      covered += size;
    }

    return windows;
  }

  function maxPagesForRepliedSearch(maxLookbackDays) {
    if (maxLookbackDays >= 365) return 5;
    if (maxLookbackDays >= 180) return 4;
    return 3;
  }

  async function fetchSellerReplyCatalog(options) {
    const maxDays = clampCatalogDays(options.days, MAX_CATALOG_DAYS);
    const maxItems = Math.max(10, Math.min(150, Number(options.maxItems) || 100));
    const result = await fetchRepliedReviewPages(maxDays, {
      maxItems,
      maxPagesPerWindow: maxPagesForRepliedSearch(maxDays),
    });

    if (!result.catalog.length) {
      throw new Error(
        `최근 ${formatLookupDaysLabel(maxDays)} 내 답글 등록 리뷰가 없습니다.\n\n` +
          '리뷰 관리에서 답글을 작성한 뒤 다시 시도하거나,\n' +
          '「엑셀 양식」·직접 입력으로 샘플을 등록해 주세요.'
      );
    }

    return {
      catalog: result.catalog,
      totalScanned: result.totalScanned,
      withBodyCount: result.withBodyCount,
      days: result.searchedDays || maxDays,
      maxDays,
      searchedDays: result.searchedDays || maxDays,
      windowsScanned: result.windowsScanned,
    };
  }

  async function fetchSellerReplySamples(options) {
    const maxDays = clampCatalogDays(options.days, 180);
    const maxSamples = Math.max(2, Math.min(20, Number(options.maxSamples) || 15));
    const result = await fetchRepliedReviewPages(maxDays, {
      maxItems: maxSamples * 3,
      maxPagesPerWindow: maxPagesForRepliedSearch(maxDays),
    });

    const samples = result.catalog.filter((item) => item.hasBody).map((item) => item.comment);
    const unique = normalizeSampleList(samples).slice(0, maxSamples);

    if (unique.length >= 2) {
      return {
        samples: unique,
        sampleCount: unique.length,
        repliedCount: result.catalog.length,
        totalScanned: result.totalScanned,
        days: result.searchedDays || maxDays,
        maxDays,
        searchedDays: result.searchedDays || maxDays,
      };
    }

    const totalScanned = result.totalScanned || 0;
    const withBodyCount = result.withBodyCount || 0;
    const scannedDays = result.searchedDays || maxDays;

    if (withBodyCount > 0) {
      throw new Error(
        `답글 ${withBodyCount}건을 찾았지만 본문을 읽지 못했습니다.\n` +
          '「답글 선택 · 스타일 분석」 화면에서 직접 고르거나, 엑셀/직접 입력을 사용해 주세요.'
      );
    }

    throw new Error(
      `최근 ${scannedDays}일(약 ${formatDaysAsYears(scannedDays)}) 내 답글 본문을 읽을 수 있는 리뷰가 2건 미만입니다(${totalScanned}건 검색).\n` +
        '기간을 늘리거나 직접 샘플을 입력해 주세요.'
    );
  }

  function formatDaysAsYears(days) {
    if (days >= 365) {
      const years = Math.round((days / 365) * 10) / 10;
      return years === 1 ? '1년' : `${years}년`;
    }
    return `${days}일`;
  }

  async function fetchRepliedReviewPages(maxLookbackDays, options = {}) {
    const maxItems = Math.max(2, Number(options.maxItems) || 80);
    const maxPagesPerWindow = Math.max(1, Number(options.maxPagesPerWindow) || 3);
    const searchUrl = await resolveSearchUrl();
    const catalog = [];
    const seenIds = new Set();
    let totalScanned = 0;
    let windowsScanned = 0;
    let searchedDays = 0;
    const windows = buildLookbackWindows(maxLookbackDays);

    for (const window of windows) {
      if (catalog.length >= maxItems) break;

      let page = 0;
      let hasMore = true;
      let windowHadResults = false;

      while (hasMore && catalog.length < maxItems && page < maxPagesPerWindow) {
        const payload = buildSearchPayload(page, window, { onlyReplied: true });
        let json;

        try {
          json = await postSearch(searchUrl, payload);
        } catch (err) {
          if (page === 0 && isRecoverableSearchError(err)) break;
          throw err;
        }

        const contents = json?.contents || json?.data?.contents || [];

        if (!Array.isArray(contents)) {
          throw new Error('리뷰 목록 형식을 인식하지 못했습니다.');
        }

        totalScanned += contents.length;
        if (contents.length > 0) windowHadResults = true;

        for (const item of contents) {
          if (!itemHasSellerComment(item)) continue;
          const id = String(item.id ?? '').trim();
          if (!id || seenIds.has(id)) continue;

          const reviewFull = normalizeReviewContent(item.reviewContent || '');
          const comment = extractSellerComment(item, reviewFull);
          seenIds.add(id);
          catalog.push({
            id,
            comment: comment || '',
            hasBody: !!comment,
            productName: item.productName || '',
            createDate: item.createDate || '',
            reviewScore: item.reviewScore != null ? String(item.reviewScore) : '',
            reviewFull,
            reviewPreview: reviewFull.slice(0, 100),
          });
          if (catalog.length >= maxItems) break;
        }

        hasMore = contents.length >= payload.size;
        page += 1;
      }

      windowsScanned += 1;
      searchedDays = window.startDaysAgo;

      if (windowHadResults && catalog.length >= maxItems) break;
    }

    await enrichCatalogComments(catalog, searchUrl);

    return {
      catalog,
      totalScanned,
      withBodyCount: catalog.filter((item) => item.hasBody).length,
      searchedDays,
      windowsScanned,
      detailFetchedCount: catalog.filter((item) => item.detailFetched).length,
    };
  }

  const DETAIL_FETCH_CONCURRENCY = 8;

  async function enrichCatalogComments(catalog, searchUrl) {
    const pending = catalog.filter((entry) => !entry.hasBody);
    if (!pending.length) return;

    let cursor = 0;

    async function worker() {
      while (cursor < pending.length) {
        const entry = pending[cursor];
        cursor += 1;

        const detail = await fetchReviewDetailItem(entry.id, searchUrl);
        if (!detail) continue;

        entry.detailFetched = true;
        const comment = extractSellerComment(detail, entry.reviewFull || entry.reviewPreview || '');
        if (!comment) continue;

        entry.comment = comment;
        entry.hasBody = true;
      }
    }

    const workers = Math.min(DETAIL_FETCH_CONCURRENCY, pending.length);
    await Promise.all(Array.from({ length: workers }, () => worker()));
  }

  async function fetchReviewDetailItem(reviewId, searchUrl) {
    const detailTemplate = await readCapturedDetailTemplate();
    const candidates = buildDetailUrlCandidates(reviewId, searchUrl, detailTemplate);

    for (const url of candidates) {
      try {
        const res = await fetch(url, {
          method: 'GET',
          credentials: 'include',
          headers: { Accept: 'application/json' },
        });
        if (!res.ok) continue;

        const json = await res.json();
        const data = json?.content || json?.data?.content || json?.data || json;
        if (!data || typeof data !== 'object' || Array.isArray(data)) continue;

        if (String(data.id ?? reviewId) === String(reviewId) || hasReviewCommentBody(data.reviewComment)) {
          return data;
        }
      } catch (_) {}
    }

    return null;
  }

  function buildDetailUrlCandidates(reviewId, searchUrl, capturedTemplate) {
    const candidates = [];

    if (capturedTemplate) {
      candidates.push(String(capturedTemplate).replace('{id}', reviewId));
    }

    if (searchUrl) {
      candidates.push(searchUrl.replace(/\/search(\?.*)?$/i, `/${reviewId}`));

      try {
        const parsed = new URL(searchUrl);
        const basePath = parsed.pathname.replace(/\/search(\?.*)?$/i, '');
        candidates.push(`${parsed.origin}${basePath}/${reviewId}`);
      } catch (_) {}
    }

    const configured =
      typeof CONFIG !== 'undefined' && CONFIG.REVIEW_DETAIL_URL
        ? String(CONFIG.REVIEW_DETAIL_URL).trim()
        : '';
    if (configured) {
      candidates.push(configured.replace('{id}', reviewId).replace('{reviewId}', reviewId));
    }

    return [...new Set(candidates.filter(Boolean).map((url) => toAbsoluteUrl(url)))];
  }

  function readCapturedDetailTemplate() {
    return new Promise((resolve) => {
      const handler = (event) => {
        if (event.source !== window || event.data?.type !== 'SS_REVIEW_DETAIL_TEMPLATE') return;
        window.removeEventListener('message', handler);
        resolve(event.data.template || null);
      };
      window.addEventListener('message', handler);
      window.postMessage({ type: 'SS_REVIEW_GET_DETAIL_TEMPLATE' }, '*');
      setTimeout(() => {
        window.removeEventListener('message', handler);
        resolve(null);
      }, 300);
    });
  }

  function isRecoverableSearchError(err) {
    const msg = String(err?.message || err || '');
    return /유효하지|invalid|validation|bad request|400/i.test(msg);
  }

  function itemHasSellerComment(item) {
    if (!item || typeof item !== 'object') return false;
    if (hasReviewCommentBody(item.reviewComment)) return true;
    const flag = item.hasComment;
    return flag === true || flag === 'true';
  }

  function hasReviewCommentBody(reviewComment) {
    if (!reviewComment || typeof reviewComment !== 'object') return false;
    const text = reviewComment.unescapeCommentContent || reviewComment.commentContent;
    return !!String(text ?? '').trim();
  }

  function extractSellerComment(item, reviewContent = '') {
    if (!item || typeof item !== 'object') return '';

    const reviewNorm = normalizeReviewContent(reviewContent || item.reviewContent || '');

    const fromReviewComment = extractFromCommentBundle(item.reviewComment, reviewNorm);
    if (fromReviewComment) return fromReviewComment;

    const bundles = [
      item.sellerCommentInfo,
      item.commentInfo,
      item.storeComment,
      item.reply,
      item.sellerCommentDetail,
      item.sellerReplyInfo,
      item.comment,
    ];

    for (const bundle of bundles) {
      const text = extractFromCommentBundle(bundle, reviewNorm);
      if (text) return text;
    }

    if (Array.isArray(item.sellerComments)) {
      for (const entry of item.sellerComments) {
        const text =
          typeof entry === 'string'
            ? acceptCommentText(entry, reviewNorm)
            : extractFromCommentBundle(entry, reviewNorm);
        if (text) return text;
      }
    }

    const directKeys = [
      'commentContent',
      'sellerCommentContent',
      'sellerCommentText',
      'sellerReplyContent',
      'replyContent',
      'storeCommentContent',
      'reviewSellerComment',
      'answerContent',
      'escapeHtmlSellerCommentContent',
      'escapeHtmlCommentContent',
      'commentText',
      'replyText',
      'answerText',
    ];

    for (const key of directKeys) {
      const text = acceptCommentText(item[key], reviewNorm);
      if (text) return text;
    }

    return '';
  }

  function extractFromCommentBundle(bundle, reviewNorm) {
    if (!bundle) return '';
    if (typeof bundle === 'string') {
      return acceptCommentText(bundle, reviewNorm);
    }
    if (typeof bundle !== 'object' || Array.isArray(bundle)) return '';

    const contentKeys = [
      'unescapeCommentContent',
      'commentContent',
      'content',
      'text',
      'body',
      'message',
      'commentText',
      'replyContent',
      'replyText',
      'sellerCommentContent',
      'sellerCommentText',
      'answerContent',
      'answerText',
      'escapeHtmlSellerCommentContent',
      'escapeHtmlCommentContent',
      'storeCommentContent',
    ];

    for (const key of contentKeys) {
      const text = acceptCommentText(bundle[key], reviewNorm);
      if (text) return text;
    }

    for (const listKey of ['contents', 'commentContents', 'sellerCommentContents', 'comments']) {
      const list = bundle[listKey];
      if (!Array.isArray(list)) continue;
      for (const entry of list) {
        const text =
          typeof entry === 'string'
            ? acceptCommentText(entry, reviewNorm)
            : extractFromCommentBundle(entry, reviewNorm);
        if (text) return text;
      }
    }

    return '';
  }

  function acceptCommentText(value, reviewNorm) {
    const text = normalizeSampleText(value);
    if (!text) return '';
    if (reviewNorm && textsLikelySame(text, reviewNorm)) return '';
    return text;
  }

  function isLikelyDateOrMetaText(value) {
    const text = String(value ?? '').trim();
    if (!text) return true;
    if (/^\d{4}-\d{2}-\d{2}(?:[T\s]\d{2}:\d{2}|$)/.test(text)) return true;
    if (/^\d{4}[./-]\d{1,2}[./-]\d{1,2}$/.test(text)) return true;
    if (/^\d+$/.test(text)) return true;
    if (/^[0-9a-f-]{36}$/i.test(text)) return true;
    return false;
  }

  function textsLikelySame(a, b) {
    const left = normalizeReviewContent(a);
    const right = normalizeReviewContent(b);
    if (!left || !right) return false;
    if (left === right) return true;
    if (left.length >= 12 && right.length >= 12) {
      if (left.includes(right) || right.includes(left)) return true;
    }
    return false;
  }

  function normalizeSampleText(value) {
    const cleaned = stripHtml(String(value ?? ''))
      .replace(/\r\n/g, '\n')
      .trim();
    if (cleaned.length < 8) return '';
    if (/^https?:\/\//i.test(cleaned)) return '';
    if (isLikelyDateOrMetaText(cleaned)) return '';
    return cleaned;
  }

  function stripHtml(value) {
    return String(value ?? '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>');
  }

  function normalizeSampleList(samples) {
    const unique = [];
    const seen = new Set();
    for (const raw of samples) {
      const text = normalizeSampleText(raw);
      if (!text) continue;
      const key = text.slice(0, 100);
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(text);
    }
    return unique;
  }

  async function resolveSearchUrl() {
    const configured =
      typeof CONFIG !== 'undefined' && CONFIG.REVIEW_SEARCH_URL
        ? String(CONFIG.REVIEW_SEARCH_URL).trim()
        : '';
    if (configured) return toAbsoluteUrl(configured);

    const captured = await readCapturedUrl();
    if (captured) return toAbsoluteUrl(captured);

    const fromPerf = findSearchUrlFromPerformance();
    if (fromPerf) return toAbsoluteUrl(fromPerf);

    throw new Error(
      '리뷰 search URL을 아직 모릅니다.\n\n' +
        '1. 판매자센터 [리뷰 관리] 페이지에서 F5(새로고침)\n' +
        '2. 리뷰 목록이 화면에 보이는지 확인\n' +
        '3. 확장 프로그램 새로고침 후 다시 시도'
    );
  }

  function toAbsoluteUrl(url) {
    if (/^https?:\/\//i.test(url)) return url;
    return new URL(url, location.origin).href;
  }

  function findSearchUrlFromPerformance() {
    const entries = performance.getEntriesByType('resource');
    for (let i = entries.length - 1; i >= 0; i--) {
      const name = entries[i].name || '';
      if (!name.includes('smartstore.naver.com')) continue;
      if (!/(?:^|[/?])search(?:[/?]|$)/i.test(name)) continue;
      return name;
    }
    return null;
  }

  function readCapturedUrl() {
    return new Promise((resolve) => {
      const handler = (event) => {
        if (event.source !== window || event.data?.type !== 'SS_REVIEW_URL') return;
        window.removeEventListener('message', handler);
        resolve(event.data.url || null);
      };
      window.addEventListener('message', handler);
      window.postMessage({ type: 'SS_REVIEW_GET_URL' }, '*');
      setTimeout(() => {
        window.removeEventListener('message', handler);
        resolve(null);
      }, 300);
    });
  }

  async function postSearch(url, payload) {
    const res = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    let json;
    try {
      json = await res.json();
    } catch (_) {
      throw new Error(`API 응답 파싱 실패 (${res.status})`);
    }

    if (json?.code === 'GW.NOT_FOUND' || /NOT_FOUND/i.test(String(json?.code || ''))) {
      throw new Error(json.message || 'search URL이 맞지 않습니다.');
    }

    if (!res.ok) {
      throw new Error(json?.message || `API 오류 (${res.status})`);
    }

    return json;
  }

  function buildSearchPayload(page, range, options = {}) {
    const startDaysAgo =
      typeof range === 'number'
        ? range
        : Number(range?.startDaysAgo) || MAX_SEARCH_WINDOW_DAYS;
    const endDaysAgo = typeof range === 'number' ? 0 : Number(range?.endDaysAgo) || 0;

    const now = new Date();
    const to = new Date(now);
    to.setDate(to.getDate() - endDaysAgo);
    const from = new Date(now);
    from.setDate(from.getDate() - startDaysAgo);

    const payload = {
      reviewSearchSortType: 'REVIEW_CREATE_DATE_DESC',
      searchKeywordType: 'IDS',
      benefitKindTypeStringList: [],
      contentsStatusTypes: [],
      fromDate: formatKstIso(from, false),
      toDate: formatKstIso(to, true),
      page,
      reviewContentClassTypes: [],
      reviewScores: [],
      reviewTypes: [],
      searchKeyword: '',
      size: 500,
      sort: [],
      storeTypes: [],
      useSelectedDate: false,
    };

    if (options.onlyReplied) {
      payload.hasComment = 'true';
    } else if (options.onlyUnreplied) {
      payload.hasComment = 'false';
    }

    return payload;
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

  function mapReviewType(value) {
    const map = {
      AFTER_USE: '한달사용리뷰',
      NORMAL: '일반리뷰',
      PHOTO: '포토리뷰',
      VIDEO: '동영상리뷰',
    };
    return map[value] || value || '';
  }

  function normalizeReviewContent(text) {
    const cleaned = String(text).replace(/\r\n/g, '\n').trim();
    if (!cleaned || /^https?:\/\//i.test(cleaned)) return '';
    return cleaned;
  }
})();
