/**
 * AI 지식 관리 UI — /api/knowledge/* 연동
 */
(function () {
  const TYPE_LABEL = {
    product: '상품',
    policy: '정책',
    faq: 'FAQ',
    pending: '확인필요',
  };

  let page = 1;
  let totalPages = 1;
  let selectedEntryId = null;
  let selectedEntry = null;
  let busy = false;

  function $(id) {
    return document.getElementById(id);
  }

  function setStatus(text) {
    const el = $('knowledgeDetailStatus');
    if (el) el.textContent = text || '';
    if (text) setPageStatus(text, /실패|오류|없|필요|불가/.test(String(text)));
  }

  function selectedStoreId() {
    // 지식 탭과 동일 화면의 store_id 입력 재사용 (커머스 자동수집 로직과 무관)
    return String($('commerceStoreId')?.value || $('knowledgeStoreId')?.value || '').trim();
  }

  function filters() {
    const storeId = selectedStoreId();
    return {
      q: String($('knowledgeSearchQ')?.value || '').trim(),
      productNo: String($('knowledgeFilterProductNo')?.value || '').trim(),
      type: String($('knowledgeFilterType')?.value || ''),
      trustStatus: String($('knowledgeFilterTrust')?.value || ''),
      effectiveStatus: String($('knowledgeFilterEffective')?.value || ''),
      ...(storeId ? { storeId } : {}),
      page,
      limit: 50,
    };
  }

  function setPageStatus(text, isError) {
    const el = $('pageStatus');
    if (!el) return;
    const msg = String(text || '').trim();
    if (!msg) {
      el.textContent = '';
      el.classList.remove('show', 'error');
      return;
    }
    el.textContent = msg;
    el.classList.add('show');
    el.classList.toggle('error', !!isError);
  }

  function storeBody() {
    const storeId = selectedStoreId();
    return storeId ? { storeId } : {};
  }

  function qs(params) {
    const sp = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== '' && v != null) sp.set(k, String(v));
    });
    return sp.toString();
  }

  async function api(path, options = {}) {
    if (typeof fetchAuthApi !== 'function') {
      throw new Error('로그인이 필요합니다.');
    }
    return fetchAuthApi(path, options);
  }

  function renderSummary(summary) {
    const host = $('knowledgeSummary');
    if (!host) return;
    if (!summary) {
      host.textContent = '요약을 불러오지 못했습니다.';
      return;
    }
    const productApprox = Math.max(0, Number(summary.productFields || 0));
    host.textContent =
      `상품 필드 ${productApprox} · 정책 ${summary.policyFields || 0} · ` +
      `FAQ ${summary.approvedFaqs || 0} · 확인필요 ${summary.pendingConfirm || 0}`;
  }

  const PRODUCT_FIELD_KEYS = [
    ['productName', '상품명'],
    ['detailDescription', '상세'],
    ['specs', '사양'],
    ['usage', '사용법'],
    ['optionsCompat', '옵션'],
    ['cautions', '주의'],
    ['extra', '기타'],
  ];

  function productFilledLabels(item) {
    return PRODUCT_FIELD_KEYS.filter(([key]) => String(item?.[key] || '').trim())
      .map(([, label]) => label)
      .join(', ');
  }

  function renderCatalog(products, extras) {
    const host = $('knowledgeEntryList');
    if (!host) return;
    const productItems = Array.isArray(products) ? products : [];
    const extraItems = Array.isArray(extras) ? extras : [];
    if (!productItems.length && !extraItems.length) {
      host.innerHTML = '<div class="hint">저장된 지식이 없습니다.</div>';
      return;
    }

    const selectedNo = String($('kbProductNo')?.value || '').trim();
    const productHtml = productItems
      .map((p) => {
        const no = String(p.productNo || '').trim();
        const name = String(p.productName || '').trim() || `상품 #${no}`;
        const labels = productFilledLabels(p) || '필드 없음';
        const active = selectedNo && selectedNo === no ? ' active' : '';
        return `<button type="button" class="kb-product-card${active}" data-product-no="${escapeAttr(no)}">
          <div class="kb-product-name">${escapeHtml(name)}</div>
          <div class="kb-product-meta">#${escapeHtml(no)} · ${escapeHtml(labels)}</div>
        </button>`;
      })
      .join('');

    const extraHtml = extraItems
      .map((e) => {
        const active = e.entryId === selectedEntryId ? ' active' : '';
        return `<button type="button" class="kb-product-card${active}" data-entry-id="${escapeAttr(
          e.entryId
        )}">
          <div class="kb-product-name">[${TYPE_LABEL[e.type] || e.type}] ${escapeHtml(
            e.label || e.title || e.entryId
          )}</div>
          <div class="kb-product-meta">${escapeHtml(e.trustStatus || '')}</div>
        </button>`;
      })
      .join('');

    host.innerHTML = productHtml + extraHtml;

    host.querySelectorAll('[data-product-no]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const productNo = btn.getAttribute('data-product-no');
        host.querySelectorAll('.kb-product-card').forEach((el) => el.classList.remove('active'));
        btn.classList.add('active');
        fillDetail(null);
        if (productNo && typeof window.fillProductKnowledgeForm === 'function') {
          void window.fillProductKnowledgeForm(productNo);
          setPageStatus(`상품 #${productNo} 불러옴 · 오른쪽에서 수정하세요.`);
        }
      });
    });

    host.querySelectorAll('[data-entry-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        void selectEntry(btn.getAttribute('data-entry-id'));
      });
    });
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function escapeAttr(s) {
    return escapeHtml(s).replace(/'/g, '&#39;');
  }

  function fillDetail(entry) {
    selectedEntry = entry;
    selectedEntryId = entry?.entryId || null;
    const card = $('knowledgeDetailCard');
    if (!card) return;
    if (!entry) {
      card.hidden = true;
      return;
    }
    card.hidden = false;
    if ($('knowledgeDetailTitle')) {
      $('knowledgeDetailTitle').textContent = entry.title || entry.entryId;
    }
    const syncLine =
      entry.type === 'faq' && entry.kbSync
        ? ` · KB동기화 ${entry.kbSync.synced ? 'OK' : entry.kbSync.reason || '불일치'}`
        : '';
    if ($('knowledgeDetailMeta')) {
      $('knowledgeDetailMeta').textContent = [
        entry.entryId,
        entry.label,
        entry.source || '',
        entry.trustStatus,
        entry.effectiveStatus,
        entry.usableAsFact ? '확정근거 가능' : '확정근거 불가',
      ]
        .filter(Boolean)
        .join(' · ') + syncLine;
    }
    if ($('knowledgeDetailContent')) {
      $('knowledgeDetailContent').value = entry.content || '';
      $('knowledgeDetailContent').readOnly = entry.type === 'pending';
    }
    if ($('knowledgeDetailValidFrom')) {
      $('knowledgeDetailValidFrom').value = (entry.validFrom || '').slice(0, 10);
      $('knowledgeDetailValidFrom').disabled = entry.type === 'pending';
    }
    if ($('knowledgeDetailValidTo')) {
      $('knowledgeDetailValidTo').value = (entry.validTo || '').slice(0, 10);
      $('knowledgeDetailValidTo').disabled = entry.type === 'pending';
    }
    const isPending = entry.type === 'pending';
    if ($('knowledgeSaveBtn')) $('knowledgeSaveBtn').hidden = isPending;
    if ($('knowledgeDeleteBtn')) {
      $('knowledgeDeleteBtn').textContent = isPending ? '무시(삭제)' : '삭제';
      $('knowledgeDeleteBtn').hidden = false;
    }
    if ($('knowledgeApproveBtn')) $('knowledgeApproveBtn').hidden = !isPending;
    if ($('knowledgeDismissBtn')) $('knowledgeDismissBtn').hidden = !isPending;
    setStatus('');
  }

  async function selectEntry(entryId) {
    try {
      setStatus('불러오는 중…');
      const storeQs = selectedStoreId()
        ? `?storeId=${encodeURIComponent(selectedStoreId())}`
        : '';
      const data = await api(`/api/knowledge/entries/${encodeURIComponent(entryId)}${storeQs}`);
      fillDetail(data.entry);
      // 목록 active 표시 갱신
      document.querySelectorAll('.knowledge-entry-item').forEach((el) => {
        el.classList.toggle('active', el.getAttribute('data-entry-id') === entryId);
      });
    } catch (err) {
      setStatus(err.message || String(err));
    }
  }

  async function refresh() {
    const pageInfo = $('knowledgePageInfo');
    try {
      const summaryQs = qs(storeBody());
      const summaryData = await api(
        `/api/knowledge/summary${summaryQs ? `?${summaryQs}` : ''}`
      );
      renderSummary(summaryData.summary);

      const f = filters();
      const productQs = qs({
        ...(f.storeId ? { storeId: f.storeId } : {}),
      });
      const productsData = await api(
        `/api/product-knowledge${productQs ? `?${productQs}` : ''}`
      );
      let products = productsData.items || [];
      const q = String(f.q || '').toLowerCase();
      const productNoFilter = String(f.productNo || '').trim();
      if (productNoFilter) {
        products = products.filter((p) => String(p.productNo || '') === productNoFilter);
      }
      if (q) {
        products = products.filter((p) =>
          [p.productNo, p.productName, p.detailDescription, p.specs, p.usage, p.cautions, p.extra]
            .join(' ')
            .toLowerCase()
            .includes(q)
        );
      }

      // 정책·FAQ·확인필요는 필드 단위로만 따로 (본문 미리보기 없이)
      const entryType = f.type && f.type !== 'product' ? f.type : '';
      let extras = [];
      if (f.type !== 'product') {
        const listData = await api(
          `/api/knowledge/entries?${qs({
            ...f,
            type: entryType || undefined,
            limit: 30,
            page: 1,
          })}`
        );
        extras = (listData.items || []).filter((e) => e.type !== 'product');
        if (f.type === 'policy' || f.type === 'faq' || f.type === 'pending') {
          products = [];
        }
      }

      page = 1;
      totalPages = 1;
      renderCatalog(products, extras);
      if (pageInfo) {
        pageInfo.textContent = `상품 ${products.length}개 · 기타 ${extras.length}개`;
      }
    } catch (err) {
      renderSummary(null);
      renderCatalog([], []);
      if (pageInfo) pageInfo.textContent = '';
      setStatus(err.message || String(err));
    }
  }

  function setBusy(on) {
    busy = !!on;
    ['knowledgeSaveBtn', 'knowledgeDeleteBtn', 'knowledgeApproveBtn', 'knowledgeDismissBtn'].forEach(
      (id) => {
        const el = $(id);
        if (el && !el.hidden) el.disabled = busy;
      }
    );
  }

  async function saveSelected() {
    if (busy || !selectedEntryId || !selectedEntry || selectedEntry.type === 'pending') return;
    setBusy(true);
    try {
      setStatus('저장 중…');
      const body = {
        ...storeBody(),
        content: $('knowledgeDetailContent')?.value || '',
        validFrom: $('knowledgeDetailValidFrom')?.value || null,
        validTo: $('knowledgeDetailValidTo')?.value || null,
      };
      const data = await api(`/api/knowledge/entries/${encodeURIComponent(selectedEntryId)}`, {
        method: 'PATCH',
        body,
      });
      fillDetail(data.entry);
      await refresh();
      setStatus('저장했습니다.');
    } catch (err) {
      setStatus(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  async function deleteSelected() {
    if (busy || !selectedEntryId) return;
    const label = selectedEntry?.type === 'pending' ? '이 확인 필요 항목을 무시할까요?' : '이 지식을 삭제할까요? (FAQ 삭제 시 KB는 유지됩니다)';
    if (!window.confirm(label)) return;
    setBusy(true);
    try {
      setStatus('삭제 중…');
      await api(`/api/knowledge/entries/${encodeURIComponent(selectedEntryId)}`, {
        method: 'DELETE',
        body: { ...storeBody() },
      });
      selectedEntryId = null;
      fillDetail(null);
      await refresh();
      setStatus('삭제했습니다.');
    } catch (err) {
      setStatus(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  async function approvePending() {
    if (busy || !selectedEntry || selectedEntry.type !== 'pending') return;
    const value = String($('knowledgeDetailContent')?.value || selectedEntry.content || '').trim();
    const productNo = String(selectedEntry.productNo || '').trim();
    if (!productNo) {
      setStatus('상품번호가 없어 승인할 수 없습니다. 상품번호를 문의 테스트에서 지정하세요.');
      return;
    }
    const fact = window.prompt('KB에 저장할 사실(승인 답변)을 입력하세요.', value || '');
    if (fact == null) return;
    if (!String(fact).trim()) {
      setStatus('승인 내용이 비어 있습니다.');
      return;
    }
    setBusy(true);
    try {
      setStatus('승인 중…');
      await api(`/api/inquiry-confirmations/${encodeURIComponent(selectedEntry.confirmationId)}/approve-fact`, {
        method: 'POST',
        body: {
          ...storeBody(),
          productNo,
          field: 'extra',
          value: String(fact).trim(),
          productName: selectedEntry.productName || '',
          mode: 'mirror',
        },
      });
      selectedEntryId = null;
      fillDetail(null);
      await refresh();
      setStatus('승인·KB 반영 완료');
    } catch (err) {
      setStatus(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  async function dismissPending() {
    if (busy || !selectedEntry || selectedEntry.type !== 'pending') return;
    if (!window.confirm('이 확인 필요 항목을 무시할까요?')) return;
    setBusy(true);
    try {
      setStatus('무시 처리 중…');
      await api(`/api/inquiry-confirmations/${encodeURIComponent(selectedEntry.confirmationId)}/dismiss`, {
        method: 'POST',
        body: { reason: 'knowledge_ui' },
      });
      selectedEntryId = null;
      fillDetail(null);
      await refresh();
      setStatus('무시했습니다.');
    } catch (err) {
      setStatus(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  function bind() {
    $('knowledgeRefreshBtn')?.addEventListener('click', () => {
      page = 1;
      void refresh();
    });
    $('knowledgeSearchBtn')?.addEventListener('click', () => {
      page = 1;
      void refresh();
    });
    $('knowledgeSearchQ')?.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        page = 1;
        void refresh();
      }
    });
    $('knowledgePrevBtn')?.addEventListener('click', () => {
      if (page > 1) {
        page -= 1;
        void refresh();
      }
    });
    $('knowledgeNextBtn')?.addEventListener('click', () => {
      if (page < totalPages) {
        page += 1;
        void refresh();
      }
    });
    $('knowledgeSaveBtn')?.addEventListener('click', () => void saveSelected());
    $('knowledgeDeleteBtn')?.addEventListener('click', () => void deleteSelected());
    $('knowledgeApproveBtn')?.addEventListener('click', () => void approvePending());
    $('knowledgeDismissBtn')?.addEventListener('click', () => void dismissPending());
    $('commerceStoreId')?.addEventListener('change', () => {
      page = 1;
      void refresh();
    });
    $('knowledgeStoreId')?.addEventListener('change', () => {
      page = 1;
      void refresh();
    });
  }

  function showUsedKnowledge(usedKnowledge, judgment) {
    const card = $('inquiryUsedKnowledge');
    const list = $('inquiryUsedKnowledgeList');
    if (!card || !list) return;
    const items = Array.isArray(usedKnowledge) ? usedKnowledge : [];
    if (!items.length && !judgment) {
      card.hidden = true;
      list.textContent = '';
      return;
    }
    card.hidden = false;
    const lines = [];
    if (judgment) lines.push(`판정: ${judgment}`);
    for (const u of items.slice(0, 20)) {
      lines.push(
        `- [${u.type || '?'}] ${u.id || ''}${u.field ? ` · ${u.field}` : ''} · ${u.trustStatus || ''} · ${
          u.source || ''
        }`
      );
    }
    list.textContent = lines.join('\n') || '근거 없음';
  }

  function hideUsedKnowledge() {
    const card = $('inquiryUsedKnowledge');
    if (card) card.hidden = true;
  }

  window.KnowledgeManage = {
    refresh,
    bind,
    selectEntry,
    saveSelected,
    deleteSelected,
    approvePending,
    dismissPending,
    showUsedKnowledge,
    hideUsedKnowledge,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
