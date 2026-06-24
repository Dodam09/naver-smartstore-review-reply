/**
 * 판매자센터 리뷰 답글 일괄 등록 (내부 API)
 */
(function () {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type !== 'BULK_SUBMIT_REPLIES') return false;

    bulkSubmitReplies(message.payload || {})
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((err) => sendResponse({ ok: false, error: err.message || String(err) }));

    return true;
  });

  async function bulkSubmitReplies(payload) {
    const items = payload.items || [];
    if (!items.length) throw new Error('등록할 답글이 없습니다.');

    const template = await resolveSubmitTemplate();
    const results = { success: [], failed: [] };

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const reviewId = String(item.id ?? '').trim();
      const reply = String(item.reply ?? '').trim();

      if (!reviewId || !reply) {
        results.failed.push({ id: reviewId || item.id, error: '글번호 또는 답글이 비어 있습니다.' });
        continue;
      }

      if (reply.length < 5) {
        results.failed.push({ id: reviewId, error: '답글이 5자 미만입니다.' });
        continue;
      }

      try {
        await submitOneReply(template, reviewId, reply);
        results.success.push(reviewId);
      } catch (err) {
        results.failed.push({ id: reviewId, error: err.message || String(err) });
      }

      if (i < items.length - 1) {
        await sleep(450);
      }
    }

    if (!results.success.length && results.failed.length) {
      throw new Error(
        results.failed[0]?.error ||
          '일괄 등록에 실패했습니다. 판매자센터에서 답글 1건을 수동 등록한 뒤 다시 시도하세요.'
      );
    }

    return results;
  }

  async function submitOneReply(template, reviewId, reply) {
    const url = template.url;
    const body = buildSubmitBody(template, reviewId, reply);

    const res = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    let json = null;
    try {
      json = await res.json();
    } catch (_) {
      if (!res.ok) throw new Error(`API 오류 (${res.status})`);
      return;
    }

    if (json?.code === 'GW.NOT_FOUND' || /NOT_FOUND/i.test(String(json?.code || ''))) {
      throw new Error(json.message || '등록 API URL이 맞지 않습니다.');
    }

    if (json?.success === false || json?.result === false) {
      throw new Error(json.message || json.errorMessage || '등록 거부됨');
    }

    if (!res.ok) {
      throw new Error(json?.message || `API 오류 (${res.status})`);
    }
  }

  function buildSubmitBody(template, reviewId, reply) {
    const body = JSON.parse(JSON.stringify(template.sampleBase || {}));
    const idValue = /^\d+$/.test(reviewId) ? Number(reviewId) : reviewId;
    body[template.idKey] = idValue;
    body[template.commentKey] = reply;
    return body;
  }

  async function resolveSubmitTemplate() {
    const configuredUrl =
      typeof CONFIG !== 'undefined' && CONFIG.REVIEW_SUBMIT_URL
        ? String(CONFIG.REVIEW_SUBMIT_URL).trim()
        : '';

    const captured = await readCapturedTemplate();
    if (captured?.url && captured.idKey && captured.commentKey) {
      return {
        url: toAbsoluteUrl(captured.url),
        idKey: captured.idKey,
        commentKey: captured.commentKey,
        sampleBase: captured.sampleBase || {},
      };
    }

    if (configuredUrl) {
      return {
        url: toAbsoluteUrl(configuredUrl),
        idKey: CONFIG.REVIEW_SUBMIT_ID_KEY || 'reviewId',
        commentKey: CONFIG.REVIEW_SUBMIT_COMMENT_KEY || 'commentContent',
        sampleBase: {},
      };
    }

    throw new Error(
      '답글 등록 API를 아직 모릅니다.\n\n' +
        '1. 판매자센터 [리뷰 관리]에서 리뷰 1건에 답글을 직접 등록\n' +
        '2. 같은 탭에서 [판매자센터에 일괄 등록] 다시 시도\n\n' +
        '또는 Network에서 등록 요청 URL을 config.js REVIEW_SUBMIT_URL에 설정하세요.'
    );
  }

  function readCapturedTemplate() {
    return new Promise((resolve) => {
      const handler = (event) => {
        if (event.source !== window || event.data?.type !== 'SS_SUBMIT_TEMPLATE') return;
        window.removeEventListener('message', handler);
        try {
          resolve(event.data.template ? JSON.parse(event.data.template) : null);
        } catch (_) {
          resolve(null);
        }
      };
      window.addEventListener('message', handler);
      window.postMessage({ type: 'SS_SUBMIT_GET_TEMPLATE' }, '*');
      setTimeout(() => {
        window.removeEventListener('message', handler);
        resolve(null);
      }, 300);
    });
  }

  function toAbsoluteUrl(url) {
    if (/^https?:\/\//i.test(url)) return url;
    return new URL(url, location.origin).href;
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }
})();
