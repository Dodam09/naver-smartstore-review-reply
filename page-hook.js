/**
 * 페이지 컨텍스트(MAIN world)에서 fetch/XHR 후킹 및 localStorage 브릿지.
 * CSP가 inline script를 막으므로 외부 파일로만 주입합니다.
 */
(function () {
  if (window.__ssReviewPageHook) return;
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

  function rememberSearchUrl(url, method, body) {
    try {
      if (!url) return;
      if (String(method).toUpperCase() !== 'POST') return;
      if (!body || String(body).indexOf('reviewSearchSortType') < 0) return;
      localStorage.setItem(SEARCH_KEY, url);
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
        var url = typeof input === 'string' ? input : (input && input.url) || '';
        var method = (init && init.method) || 'GET';
        var body = (init && init.body) || '';
        rememberSearchUrl(url, method, body);
        rememberSubmitTemplate(url, method, body);
        rememberDetailUrl(url, method);
        rememberInquiryListUrl(url, method);
        rememberInquiryOpenId(url, method);
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
      window.postMessage(
        { type: 'SS_REVIEW_URL', url: localStorage.getItem(SEARCH_KEY) || null },
        '*'
      );
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
