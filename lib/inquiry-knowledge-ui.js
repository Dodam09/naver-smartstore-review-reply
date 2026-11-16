/**
 * 문의 업무 UI — judgment / usedKnowledge 표시·유지·갱신 헬퍼.
 * 서버 판정 규칙을 바꾸지 않는다. usedKnowledge가 없으면 추측·임의 생성하지 않는다.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.InquiryKnowledgeUi = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const JUDGMENT = {
    ANSWERABLE: 'ANSWERABLE',
    SELLER_CONFIRM: 'SELLER_CONFIRM',
    REALTIME_REQUIRED: 'REALTIME_REQUIRED',
  };

  function asArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function pickJudgment(item) {
    if (!item || typeof item !== 'object') return null;
    return (
      item.judgment ||
      item.evidence?.judgment ||
      null
    );
  }

  function pickUsedKnowledge(item) {
    if (!item || typeof item !== 'object') return [];
    if (Array.isArray(item.usedKnowledge)) return item.usedKnowledge;
    if (Array.isArray(item.evidence?.usedKnowledge)) return item.evidence.usedKnowledge;
    return [];
  }

  function knowledgeFieldsFromServerMeta(serverMeta) {
    if (!serverMeta || typeof serverMeta !== 'object') {
      return {
        judgment: null,
        usedKnowledge: [],
        evidence: null,
        missingFields: [],
        confirmationId: null,
      };
    }
    const evidence = serverMeta.evidence || null;
    const usedKnowledge = Array.isArray(serverMeta.usedKnowledge)
      ? serverMeta.usedKnowledge
      : asArray(evidence?.usedKnowledge);
    return {
      judgment: serverMeta.judgment || evidence?.judgment || null,
      usedKnowledge,
      evidence,
      missingFields: asArray(evidence?.missingFields || serverMeta.missingFields),
      confirmationId: serverMeta.confirmation?.id || serverMeta.confirmationId || null,
    };
  }

  function isNoProductKnowledge(item) {
    const evidence = item?.evidence || {};
    const reason = String(
      item?.confirmReason || evidence.confirmReason || evidence.productMatchReason || ''
    );
    if (evidence.productMatchStatus === 'seller_confirm') return true;
    return /등록 상품정보가 없습니다|상품정보를 확정할 수 없습니다|상품번호가 없어|상품정보가 확정되지 않았습니다/.test(
      reason
    );
  }

  function isKnowledgeNeedsReview(item) {
    const evidence = item?.evidence || {};
    if (evidence.faqConflict) return true;
    const used = pickUsedKnowledge(item);
    if (
      used.some((u) => {
        const trust = String(u?.trustStatus || '').toLowerCase();
        return trust && trust !== 'approved' && trust !== 'verified';
      })
    ) {
      return true;
    }
    return /승인 FAQ와 상품 지식|충돌|확인이 필요/.test(
      String(item?.confirmReason || evidence.confirmReason || '')
    );
  }

  /**
   * 판정·부상태 분류. usedKnowledge는 서버 값만 사용.
   */
  function classifyKnowledgeUi(item) {
    const judgmentRaw = pickJudgment(item);
    const usedKnowledge = pickUsedKnowledge(item);
    const needsManual = !!item?.needsManual && !String(item?.reply || '').trim();
    let judgment = judgmentRaw;
    if (!judgment && item?.needsConfirm) judgment = JUDGMENT.SELLER_CONFIRM;
    if (!judgment && !needsManual && String(item?.reply || '').trim()) {
      judgment = JUDGMENT.ANSWERABLE;
    }

    const noProductKnowledge = isNoProductKnowledge(item);
    const knowledgeNeedsReview = isKnowledgeNeedsReview(item);

    let primary = 'none';
    let title = '';
    let cardClass = '';
    let badgeLabel = '';
    let badgeClass = '';

    if (needsManual) {
      primary = 'manual';
      title = '직접 작성';
      cardClass = 'needs-manual';
      badgeLabel = '직접 작성';
      badgeClass = 'manual';
    } else if (judgment === JUDGMENT.REALTIME_REQUIRED) {
      primary = 'realtime';
      title = '실시간 조회 필요';
      cardClass = 'needs-realtime';
      badgeLabel = '실시간 조회 필요';
      badgeClass = 'realtime';
    } else if (judgment === JUDGMENT.SELLER_CONFIRM) {
      primary = 'seller_confirm';
      title = '판매자 확인 필요';
      cardClass = 'needs-confirm';
      badgeLabel = '확인 필요';
      badgeClass = 'confirm';
    } else if (judgment === JUDGMENT.ANSWERABLE) {
      primary = 'answerable';
      title = '답변 가능';
      cardClass = 'needs-answerable';
      badgeLabel = '답변 가능';
      badgeClass = 'answerable';
    }

    return {
      judgment,
      usedKnowledge,
      primary,
      title,
      cardClass,
      badgeLabel,
      badgeClass,
      noProductKnowledge,
      knowledgeNeedsReview,
      productNo: String(item?.productNo || evidenceProductNo(item) || '').replace(/[^\d]/g, '') || '',
      confirmReason: String(item?.confirmReason || item?.evidence?.confirmReason || '').trim(),
      missingFields: asArray(item?.missingFields || item?.evidence?.missingFields),
    };
  }

  function evidenceProductNo(item) {
    const used = pickUsedKnowledge(item);
    for (const u of used) {
      const no = String(u?.productNo || '').replace(/[^\d]/g, '');
      if (no) return no;
    }
    return '';
  }

  function formatUsedKnowledgeLines(usedKnowledge) {
    return asArray(usedKnowledge)
      .slice(0, 20)
      .map((u) => {
        const parts = [
          `[${u.type || '?'}]`,
          u.id || '',
          u.field ? `필드:${u.field}` : '',
          u.trustStatus || '',
          u.source || '',
          u.productNo ? `#${u.productNo}` : '',
        ].filter(Boolean);
        return parts.join(' · ');
      });
  }

  /** 답글 수정: 근거 필드는 유지하고 reply만 반영 */
  function applyKnowledgeOnEdit(item, nextReply) {
    const base = item && typeof item === 'object' ? { ...item } : {};
    base.reply = String(nextReply || '').trim();
    if (base.reply) base.needsManual = false;
    // judgment / usedKnowledge / evidence 유지
    return base;
  }

  /** 재생성: 서버 결과로 judgment·usedKnowledge 갱신 */
  function applyKnowledgeOnRegenerate(item, serverResult) {
    const base = item && typeof item === 'object' ? { ...item } : {};
    const fields = knowledgeFieldsFromServerMeta(serverResult);
    const text = String(
      serverResult?.text || serverResult?.reply || serverResult?.aiReply || ''
    ).trim();
    const deferred = !!serverResult?.deferred || !!serverResult?.needsManual || !text;

    if (deferred) {
      return {
        ...base,
        reply: '',
        aiReply: '',
        originalReply: '',
        needsManual: true,
        learnAsGuideline: true,
        needsConfirm: false,
        confirmReason: '',
        manualReason:
          serverResult?.reason ||
          '참고·확인된 사실에 없는 구체 내용을 지어내 직접 작성으로 넘겼습니다.',
        judgment: fields.judgment,
        usedKnowledge: fields.usedKnowledge,
        evidence: fields.evidence,
        missingFields: fields.missingFields,
        confirmationId: fields.confirmationId,
      };
    }

    return {
      ...base,
      reply: text,
      aiReply: text,
      originalReply: text,
      needsManual: false,
      learnAsGuideline: false,
      needsConfirm: !!serverResult?.needsConfirm,
      confirmReason: serverResult?.reason || fields.evidence?.confirmReason || '',
      manualReason: '',
      judgment: fields.judgment,
      usedKnowledge: fields.usedKnowledge,
      evidence: fields.evidence,
      missingFields: fields.missingFields,
      confirmationId: fields.confirmationId,
    };
  }

  /** 다건 목록에서 문의 id별 근거가 서로 섞이지 않았는지 검사 */
  function assertKnowledgeIsolation(items) {
    const list = asArray(items);
    const byId = new Map();
    for (const item of list) {
      const id = String(item?.id || '');
      if (!id) {
        return { ok: false, reason: 'missing_id' };
      }
      if (byId.has(id)) {
        return { ok: false, reason: 'duplicate_id', id };
      }
      byId.set(id, item);
      const used = pickUsedKnowledge(item);
      const ownNo = String(item?.productNo || '').replace(/[^\d]/g, '');
      if (!ownNo) continue;
      for (const u of used) {
        const uNo = String(u?.productNo || '').replace(/[^\d]/g, '');
        if (uNo && uNo !== ownNo) {
          return { ok: false, reason: 'cross_product_leak', id, ownNo, leaked: uNo };
        }
      }
    }
    return { ok: true, count: list.length };
  }

  function buildKnowledgePanelModel(item) {
    const ui = classifyKnowledgeUi(item);
    const lines = formatUsedKnowledgeLines(ui.usedKnowledge);
    const actions = [];
    if (ui.primary === 'realtime') {
      actions.push(
        '이 앱은 공식 주문·송장·재고 API를 조회하지 않습니다. 판매자센터에서 확인한 뒤 답글을 수정하세요.'
      );
    } else if (ui.primary === 'seller_confirm') {
      actions.push('초안을 검토·수정한 뒤 올려 주세요. 사실 승인이 필요하면 AI 지식 관리에서 처리하세요.');
    } else if (ui.primary === 'answerable') {
      actions.push('사용된 지식을 확인하고 필요하면 문구만 다듬어 주세요.');
    }

    return {
      ...ui,
      usedKnowledgeLines: lines,
      hasUsedKnowledge: lines.length > 0,
      secondaryBadges: [
        ui.noProductKnowledge ? { label: '상품정보 없음', className: 'no-product' } : null,
        ui.knowledgeNeedsReview ? { label: '지식 확인 필요', className: 'knowledge-review' } : null,
        ui.productNo ? { label: `#${ui.productNo}`, className: 'product-no' } : null,
      ].filter(Boolean),
      actions,
    };
  }

  return {
    JUDGMENT,
    pickJudgment,
    pickUsedKnowledge,
    knowledgeFieldsFromServerMeta,
    classifyKnowledgeUi,
    formatUsedKnowledgeLines,
    applyKnowledgeOnEdit,
    applyKnowledgeOnRegenerate,
    assertKnowledgeIsolation,
    buildKnowledgePanelModel,
    isNoProductKnowledge,
    isKnowledgeNeedsReview,
  };
});
