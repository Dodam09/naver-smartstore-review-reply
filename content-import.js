/**
 * 판매자센터 리뷰 search API → 확장 parsedRows 형식 변환
 *
 * URL은 페이지가 성공적으로 호출한 search 주소만 사용합니다.
 * (잘못된 URL 추측 호출 → GW.NOT_FOUND 방지)
 */
(function () {
  const SEARCH_URL_KEY = '__ss_review_search_url';

  injectNetworkHook();

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type !== 'FETCH_REVIEWS') return false;

    fetchReviews(message.payload || {})
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((err) => sendResponse({ ok: false, error: err.message || String(err) }));

    return true;
  });

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.data?.type !== 'SS_REVIEW_GET_URL') return;
    const script = document.createElement('script');
    script.textContent = `
      window.postMessage({
        type: 'SS_REVIEW_URL',
        url: localStorage.getItem('${SEARCH_URL_KEY}') || null
      }, '*');
    `;
    (document.head || document.documentElement).appendChild(script);
    script.remove();
  });

  function injectNetworkHook() {
    if (document.documentElement.dataset.ssReviewHook) return;
    document.documentElement.dataset.ssReviewHook = '1';

    const script = document.createElement('script');
    script.textContent = `
      (function () {
        if (window.__ssReviewNetworkHook) return;
        window.__ssReviewNetworkHook = true;
        var KEY = '${SEARCH_URL_KEY}';

        function rememberSearchUrl(url, method, body) {
          try {
            if (!url) return;
            if (String(method).toUpperCase() !== 'POST') return;
            if (!body || String(body).indexOf('reviewSearchSortType') < 0) return;
            localStorage.setItem(KEY, url);
          } catch (e) {}
        }

        var origFetch = window.fetch;
        window.fetch = function (input, init) {
          try {
            var url = typeof input === 'string' ? input : (input && input.url) || '';
            var method = (init && init.method) || 'GET';
            var body = (init && init.body) || '';
            rememberSearchUrl(url, method, body);
          } catch (e) {}
          return origFetch.apply(this, arguments);
        };

        var origOpen = XMLHttpRequest.prototype.open;
        var origSend = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.open = function (method, url) {
          this.__ssMethod = method;
          this.__ssUrl = url;
          return origOpen.apply(this, arguments);
        };
        XMLHttpRequest.prototype.send = function (body) {
          try {
            rememberSearchUrl(this.__ssUrl, this.__ssMethod, body);
          } catch (e) {}
          return origSend.apply(this, arguments);
        };
      })();
    `;
    (document.head || document.documentElement).appendChild(script);
    script.remove();
  }

  async function fetchReviews(options) {
    const days = Math.max(1, Math.min(90, Number(options.days) || 7));
    const onlyUnreplied = options.onlyUnreplied !== false;
    const searchUrl = await resolveSearchUrl();

    const allItems = [];
    let page = 0;
    let hasMore = true;

    while (hasMore) {
      const payload = buildSearchPayload(page, days);
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

      if (onlyUnreplied && item.hasComment === true) {
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
        '3. 확장 프로그램 새로고침 후 다시 [판매자센터에서 가져오기]\n\n' +
        '계속 안 되면 Network > search(성공, 200) > Headers의 Request URL을 config.js REVIEW_SEARCH_URL에 넣어주세요.'
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
      throw new Error(
        json.message ||
          'search URL이 맞지 않습니다. 리뷰 관리 페이지를 새로고침한 뒤 다시 시도하세요.'
      );
    }

    if (!res.ok) {
      throw new Error(json?.message || `API 오류 (${res.status})`);
    }

    return json;
  }

  function buildSearchPayload(page, days) {
    const now = new Date();
    const from = new Date(now);
    from.setDate(from.getDate() - days);

    return {
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
