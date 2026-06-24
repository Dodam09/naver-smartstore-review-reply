/**
 * 판매자센터 리뷰 search API
 */
(function () {
  injectPageHook();

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
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
    const days = Math.max(1, Math.min(90, Number(options.days) || 7));
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
      sourceLabel: `판매자센터 (최근 ${days}일)`,
    };
  }

  async function fetchSellerReplyCatalog(options) {
    const days = Math.max(7, Math.min(90, Number(options.days) || 90));
    const maxItems = Math.max(10, Math.min(100, Number(options.maxItems) || 80));
    const { catalog, totalScanned, withBodyCount } = await fetchRepliedReviewPages(days, {
      maxItems,
      maxPages: 6,
    });

    if (!catalog.length) {
      throw new Error(`최근 ${days}일 내 답글 등록 리뷰가 없습니다.`);
    }

    return {
      catalog,
      totalScanned,
      withBodyCount,
      days,
    };
  }

  async function fetchSellerReplySamples(options) {
    const days = Math.max(7, Math.min(90, Number(options.days) || 30));
    const maxSamples = Math.max(2, Math.min(20, Number(options.maxSamples) || 15));
    const { catalog, totalScanned, withBodyCount } = await fetchRepliedReviewPages(days, {
      maxItems: maxSamples * 3,
      maxPages: 4,
    });

    const samples = catalog.filter((item) => item.hasBody).map((item) => item.comment);
    const unique = normalizeSampleList(samples).slice(0, maxSamples);
    const repliedCount = catalog.length;

    if (unique.length < 2) {
      throw new Error(
        withBodyCount > 0
          ? `답글 ${withBodyCount}건을 찾았지만 본문을 읽지 못했습니다.\n` +
              '「답글 선택 · 스타일 분석」 화면에서 직접 고르거나, 엑셀/직접 입력을 사용해 주세요.'
          : `최근 ${days}일 내 답글 본문을 읽을 수 있는 리뷰가 2건 미만입니다(${totalScanned}건 검색).\n기간을 늘리거나 직접 샘플을 입력해 주세요.`
      );
    }

    return {
      samples: unique,
      sampleCount: unique.length,
      repliedCount,
      totalScanned,
      days,
    };
  }

  async function fetchRepliedReviewPages(days, options = {}) {
    const maxItems = Math.max(2, Number(options.maxItems) || 80);
    const maxPages = Math.max(1, Number(options.maxPages) || 5);
    const searchUrl = await resolveSearchUrl();
    const catalog = [];
    let totalScanned = 0;
    let page = 0;
    let hasMore = true;

    while (hasMore && catalog.length < maxItems && page < maxPages) {
      const payload = buildSearchPayload(page, days, { onlyReplied: true });
      const json = await postSearch(searchUrl, payload);
      const contents = json?.contents || json?.data?.contents || [];

      if (!Array.isArray(contents)) {
        throw new Error('리뷰 목록 형식을 인식하지 못했습니다.');
      }

      totalScanned += contents.length;

      if (page === 0 && contents.length === 0) {
        throw new Error(
          `최근 ${days}일 내 답글 등록 리뷰가 없습니다.\n\n` +
            '리뷰 관리에서 답글을 작성한 뒤 다시 시도하거나,\n' +
            '「엑셀 양식」·직접 입력으로 샘플을 등록해 주세요.'
        );
      }

      for (const item of contents) {
        if (!itemHasSellerComment(item)) continue;
        const comment = extractSellerComment(item);
        catalog.push({
          id: String(item.id ?? '').trim(),
          comment: comment || '',
          hasBody: !!comment,
          productName: item.productName || '',
          createDate: item.createDate || '',
          reviewScore: item.reviewScore != null ? String(item.reviewScore) : '',
          reviewPreview: normalizeReviewContent(item.reviewContent || '').slice(0, 100),
        });
        if (catalog.length >= maxItems) break;
      }

      hasMore = contents.length >= payload.size;
      page += 1;
    }

    return {
      catalog,
      totalScanned,
      withBodyCount: catalog.filter((item) => item.hasBody).length,
      days,
    };
  }

  function itemHasSellerComment(item) {
    if (!item || typeof item !== 'object') return false;
    const flag = item.hasComment;
    return flag === true || flag === 'true';
  }

  function extractSellerComment(item) {
    if (!item || typeof item !== 'object') return '';

    const blockedKeys = new Set([
      'reviewContent',
      'parentReviewContent',
      'escapeHtmlParentReviewContent',
      'productName',
      'maskedWriterId',
      'writerIdNo',
    ]);

    const direct = [
      item.sellerComment,
      item.sellerCommentContent,
      item.sellerCommentText,
      item.commentContent,
      item.sellerReply,
      item.sellerReplyContent,
      item.replyContent,
      item.storeComment,
      item.storeCommentContent,
      item.reviewSellerComment,
      item.answerContent,
    ];

    for (const value of direct) {
      const text = normalizeSampleText(value);
      if (text) return text;
    }

    if (item.sellerCommentInfo && typeof item.sellerCommentInfo === 'object') {
      const nested = extractSellerComment(item.sellerCommentInfo);
      if (nested) return nested;
    }

    if (item.comment && typeof item.comment === 'object') {
      const nested = extractSellerComment(item.comment);
      if (nested) return nested;
    }

    if (item.comment && typeof item.comment === 'string') {
      const text = normalizeSampleText(item.comment);
      if (text) return text;
    }

    for (const [key, value] of Object.entries(item)) {
      if (blockedKeys.has(key)) continue;
      if (!/comment|reply|답글|answer/i.test(key)) continue;
      if (typeof value === 'string') {
        const text = normalizeSampleText(value);
        if (text) return text;
      } else if (value && typeof value === 'object') {
        const nested = extractSellerComment(value);
        if (nested) return nested;
      }
    }

    if (Array.isArray(item.comments)) {
      for (const c of item.comments) {
        const text = typeof c === 'string' ? normalizeSampleText(c) : extractSellerComment(c);
        if (text) return text;
      }
    }

    return '';
  }

  function normalizeSampleText(value) {
    const cleaned = String(value ?? '')
      .replace(/\r\n/g, '\n')
      .trim();
    if (cleaned.length < 8) return '';
    if (/^https?:\/\//i.test(cleaned)) return '';
    return cleaned;
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

  function buildSearchPayload(page, days, options = {}) {
    const now = new Date();
    const from = new Date(now);
    from.setDate(from.getDate() - days);

    const payload = {
      reviewSearchSortType: 'REVIEW_CREATE_DATE_DESC',
      searchKeywordType: 'IDS',
      benefitKindTypeStringList: [],
      contentsStatusTypes: [],
      fromDate: formatKstIso(from, false),
      toDate: formatKstIso(now, true),
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
