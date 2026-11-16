/**
 * 페이지 컨텍스트(MAIN world)에서 fetch/XHR 후킹 및 localStorage 브릿지.
 * CSP가 inline script를 막으므로 외부 파일로만 주입합니다.
 */
(function () {
  var PAGE_HOOK_VERSION = 3;
  if (window.__ssReviewPageHookVersion === PAGE_HOOK_VERSION && window.__ssReviewPageHook) return;
  window.__ssReviewPageHookVersion = PAGE_HOOK_VERSION;
  window.__ssReviewPageHook = true;

  var SEARCH_KEY = '__ss_review_search_url';
  var SUBMIT_KEY = '__ss_review_submit_template';
  var DETAIL_KEY = '__ss_review_detail_url_template';
  var INQUIRY_LIST_KEY = '__ss_inquiry_list_url_base';
  var INQUIRY_OPEN_ID_KEY = '__ss_inquiry_open_id';

  function rememberInquiryListUrl(url, method) {
    try {
      if (!url || String(method).toUpperCase() !== 'GET') return;
      if (url.indexOf('/comments/pages') < 0) return;
      localStorage.setItem(INQUIRY_LIST_KEY, String(url).split('?')[0]);
    } catch (e) {}
  }

  function rememberInquiryOpenId(url, method) {
    try {
      if (!url || String(method).toUpperCase() !== 'GET') return;
      var u = String(url);
      if (u.indexOf('/comments/pages') >= 0) return;
      var m = u.match(/\/comments\/(\d+)(?:\/replies|\/detail)?(?:\?|$|\/)/);
      if (!m) return;
      // 목록/상세 API prefetch는 localStorage만 갱신 (postMessage 금지 → 페이지 멈춤 방지)
      if (/\/api\//i.test(u) && !/\/replies|\/detail/i.test(u)) {
        localStorage.setItem(INQUIRY_OPEN_ID_KEY, m[1]);
        return;
      }
      var prev = localStorage.getItem(INQUIRY_OPEN_ID_KEY);
      localStorage.setItem(INQUIRY_OPEN_ID_KEY, m[1]);
      if (prev === m[1]) return;
      window.postMessage({ type: 'SS_INQUIRY_OPEN_ID', id: m[1] }, '*');
    } catch (e) {}
  }

  function rememberDetailUrl(url, method) {
    try {
      if (!url || String(method).toUpperCase() !== 'GET') return;
      if (url.indexOf('smartstore.naver.com') < 0) return;
      if (url.indexOf('/review') < 0) return;
      if (/\/search/i.test(url)) return;
      var template = String(url).replace(/\/(\d+)(?=\/|$|\?)/, '/{id}');
      if (template.indexOf('{id}') < 0) return;
      localStorage.setItem(DETAIL_KEY, template);
    } catch (e) {}
  }

  /** 판매자센터 SPA 화면 경로 — API가 아님. 여기에 POST하면 405 */
  function isSellerUiPageUrl(url) {
    var u = String(url || '');
    return /\/mg\//i.test(u) || /\/#\/mg\//i.test(u);
  }

  function isReviewSearchApiUrl(url) {
    var u = String(url || '');
    if (!u || isSellerUiPageUrl(u)) return false;
    // HTML 페이지(/mg/contents/review/search)와 구분: API 경로만
    var hasApi =
      /\/api\//i.test(u) ||
      /sell\.smartstore\.naver\.com\/(?:o|n|i)\//i.test(u) ||
      /^\/(?:api|o|n|i)\//i.test(u);
    if (!hasApi) return false;
    if (/\/reviews?\/search/i.test(u)) return true;
    if (/review/i.test(u) && /(?:^|[/?])search(?:[/?]|$|\?)/i.test(u)) return true;
    return false;
  }

  function saveSearchEndpoint(url, method) {
    try {
      if (isSellerUiPageUrl(url)) return;
      var clean = String(url).split('?')[0];
      if (!clean) return;
      localStorage.setItem(
        SEARCH_KEY,
        JSON.stringify({
          url: clean,
          method: String(method || 'POST').toUpperCase() === 'GET' ? 'GET' : 'POST',
        })
      );
    } catch (e) {}
  }

  function rememberSearchUrl(url, method, body) {
    try {
      if (!url || isSellerUiPageUrl(url)) return;
      var m = String(method || 'GET').toUpperCase();
      var bodyStr = '';
      try {
        if (typeof body === 'string') bodyStr = body;
        else if (
          body &&
          typeof body === 'object' &&
          typeof body.toString === 'function' &&
          !(typeof ReadableStream !== 'undefined' && body instanceof ReadableStream)
        ) {
          bodyStr = String(body);
        }
      } catch (e2) {
        bodyStr = '';
      }
      var hasMarker = bodyStr.indexOf('reviewSearchSortType') >= 0;
      var looksLike = isReviewSearchApiUrl(url);
      // body 마커가 있으면 API로 확정 (경로에 search가 없어도)
      if (m === 'POST' && (hasMarker || looksLike)) {
        saveSearchEndpoint(url, 'POST');
        return;
      }
      if (m === 'GET' && (looksLike || (hasMarker && /\/api\//i.test(String(url))))) {
        saveSearchEndpoint(url, 'GET');
      }
    } catch (e) {}
  }

  function rememberSubmitTemplate(url, method, body) {
    try {
      if (!url || String(method).toUpperCase() !== 'POST' || !body) return;
      var s = String(body);
      if (s.indexOf('reviewSearchSortType') >= 0) return;
      var obj = JSON.parse(s);
      if (!obj || typeof obj !== 'object') return;

      var keys = Object.keys(obj);
      var idKey = null;
      var commentKey = null;

      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        if (!idKey && /^(reviewId|reviewNo|id|review_id)$/i.test(k)) idKey = k;
      }
      for (var j = 0; j < keys.length; j++) {
        var k2 = keys[j];
        if (/comment|reply|답글|content|text|body/i.test(k2) && k2.toLowerCase().indexOf('review') < 0) {
          if (typeof obj[k2] === 'string' && obj[k2].length >= 4) {
            commentKey = k2;
            break;
          }
        }
      }
      if (!idKey || !commentKey) return;

      localStorage.setItem(
        SUBMIT_KEY,
        JSON.stringify({
          url: url,
          idKey: idKey,
          commentKey: commentKey,
          sampleBase: obj,
        })
      );
    } catch (e) {}
  }

  function hookNetwork() {
    var origFetch = window.fetch;
    window.fetch = function (input, init) {
      try {
        var req = null;
        try {
          if (typeof Request !== 'undefined' && input instanceof Request) req = input;
        } catch (eReq) {
          req = null;
        }
        var url =
          typeof input === 'string'
            ? input
            : (req && req.url) || (input && input.url) || '';
        // Request 객체만 넘기는 경우 init.method가 비어 GET으로 오인 → search URL 미캡처 → 잘못된 URL에 POST → 405
        var method =
          (init && init.method) || (req && req.method) || 'GET';
        var body = init && init.body != null ? init.body : '';
        rememberSearchUrl(url, method, body);
        rememberSubmitTemplate(url, method, body);
        rememberDetailUrl(url, method);
        rememberInquiryListUrl(url, method);
        rememberInquiryOpenId(url, method);
        // Request body는 스트림이라 동기 불가 → clone 후 비동기 재캡처
        // URL에 review/search가 없어도 body의 reviewSearchSortType으로 캡처
        if (req && String(method).toUpperCase() === 'POST' && !body) {
          try {
            req
              .clone()
              .text()
              .then(function (t) {
                rememberSearchUrl(url, method, t);
              })
              .catch(function () {});
          } catch (eClone) {}
        }
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
        rememberSubmitTemplate(this.__ssUrl, this.__ssMethod, body);
        rememberDetailUrl(this.__ssUrl, this.__ssMethod);
        rememberInquiryListUrl(this.__ssUrl, this.__ssMethod);
        rememberInquiryOpenId(this.__ssUrl, this.__ssMethod);
      } catch (e) {}
      return origSend.apply(this, arguments);
    };
  }

  hookNetwork();

  window.addEventListener('message', function (event) {
    if (event.source !== window || !event.data) return;

    if (event.data.type === 'SS_REVIEW_GET_URL') {
      var raw = null;
      var methodOut = 'POST';
      var urlOut = null;
      try {
        raw = localStorage.getItem(SEARCH_KEY);
        if (raw) {
          if (raw.charAt(0) === '{') {
            var parsed = JSON.parse(raw);
            urlOut = parsed && parsed.url ? parsed.url : null;
            methodOut = parsed && parsed.method ? parsed.method : 'POST';
          } else {
            urlOut = raw;
            methodOut = 'POST';
          }
        }
      } catch (eRead) {
        urlOut = raw;
      }
      window.postMessage(
        { type: 'SS_REVIEW_URL', url: urlOut, method: methodOut },
        '*'
      );
    }

    if (event.data.type === 'SS_REVIEW_CLEAR_URL') {
      try {
        localStorage.removeItem(SEARCH_KEY);
      } catch (e) {}
      window.postMessage({ type: 'SS_REVIEW_URL_CLEARED', ok: true }, '*');
    }

    if (event.data.type === 'SS_REVIEW_SAVE_URL') {
      try {
        var saveUrl = event.data.url;
        var saveMethod = event.data.method || 'POST';
        if (saveUrl && !isSellerUiPageUrl(saveUrl)) {
          saveSearchEndpoint(saveUrl, saveMethod);
        }
      } catch (eSave) {}
      window.postMessage({ type: 'SS_REVIEW_URL_SAVED', ok: true }, '*');
    }

    if (event.data.type === 'SS_SUBMIT_GET_TEMPLATE') {
      window.postMessage(
        { type: 'SS_SUBMIT_TEMPLATE', template: localStorage.getItem(SUBMIT_KEY) },
        '*'
      );
    }

    if (event.data.type === 'SS_REVIEW_GET_DETAIL_TEMPLATE') {
      window.postMessage(
        { type: 'SS_REVIEW_DETAIL_TEMPLATE', template: localStorage.getItem(DETAIL_KEY) || null },
        '*'
      );
    }

    if (event.data.type === 'SS_INQUIRY_GET_LIST_BASE') {
      window.postMessage(
        { type: 'SS_INQUIRY_LIST_BASE', url: localStorage.getItem(INQUIRY_LIST_KEY) || null },
        '*'
      );
    }

    if (event.data.type === 'SS_INQUIRY_GET_OPEN_ID') {
      var openId = localStorage.getItem(INQUIRY_OPEN_ID_KEY) || null;
      window.postMessage({ type: 'SS_INQUIRY_OPEN_ID', id: openId }, '*');
    }
  });
})();
