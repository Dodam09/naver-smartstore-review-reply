/**
 * 문의 지식 관리 — 별도 큰 창
 */
(function () {
  function $(id) {
    return document.getElementById(id);
  }

  function knowledgeUiStoreId() {
    return String($('knowledgeStoreId')?.value || $('commerceStoreId')?.value || '').trim();
  }

  function knowledgeUiStoreScope() {
    const storeId = knowledgeUiStoreId();
    return storeId ? { storeId } : {};
  }

  function knowledgeUiStoreQuery() {
    const storeId = knowledgeUiStoreId();
    return storeId ? `?storeId=${encodeURIComponent(storeId)}` : '';
  }

  function fillAmilyExampleKnowledgeForm() {
    const set = (id, value) => {
      const el = $(id);
      if (el) el.value = value;
    };
    set('kbProductNo', '9373097375');
    set('kbProductName', '아밀리 락토프리 프로바이오틱스');
    set(
      'kbDetail',
      '반려동물(강아지·고양이) 전용 락토프리 프로바이오틱스. Lactobacillus crispatus KT-11 유산균과 프리바이오틱스·브로멜라인 소화효소를 포함한 제품으로 안내됩니다.'
    );
    set(
      'kbSpecs',
      '균주: Lactobacillus crispatus KT-11. 유당·포도당·솔비톨·자일리톨 및 인공감미료·인공색소·글루텐 등 배제 안내(출시 보도 기준).'
    );
    set('kbUsage', '하루 1회, 사료나 간식에 직접 뿌리거나 물에 녹여 급여. 기호에 따라 단독 급여 가능.');
    set('kbOptions', '단품 / 2개 묶음 등 구성으로 판매(스토어 옵션 기준).');
    set('kbCautions', '반려동물 전용. 사람 섭취 금지. 이상 증상이 있으면 급여를 중단하고 수의사와 상담하세요.');
    set('kbExtra', '자사몰 배송비 안내: 3,000원 (5만원 이상 구매 시 무료) — 스토어 설정과 다를 수 있음.');
    set('policyShipping', '기본 배송비 3,000원, 50,000원 이상 구매 시 무료배송(자사몰 기준·스토어 설정 확인).');
    set(
      'policyExchange',
      '단순 변심 교환·반품은 수령 후 7일 이내, 상품 미개봉·재판매 가능 상태일 때 가능(스토어 정책에 따름).'
    );
    set('policyRefund', '환불은 결제 수단에 따라 영업일 기준 처리됩니다. 주문별 진행 상황은 판매자센터에서 확인합니다.');
    set('policyCs', '평일 고객센터 응대(스토어 공지 시간 기준). 주문·송장·재고는 실시간 확인 후 안내.');
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
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function fillProductKnowledgeForm(productNo) {
    const no = String(productNo || '').trim();
    if (!no) return;
    if ($('kbProductNo')) $('kbProductNo').value = no;
    await loadProductKnowledgeToForm();
  }

  async function saveProductKnowledgeFromForm() {
    const status = $('kbStatus');
    const btn = $('kbSaveBtn');
    if (btn?.disabled) return;
    try {
      if (typeof fetchAuthApi !== 'function') throw new Error('로그인이 필요합니다.');
      const productNo = String($('kbProductNo')?.value || '').trim();
      if (!productNo) throw new Error('상품번호를 입력하세요.');
      if (btn) btn.disabled = true;
      setPageStatus('저장 중…');
      if (status) status.textContent = '저장 중…';
      const data = await fetchAuthApi('/api/product-knowledge', {
        method: 'POST',
        body: {
          ...knowledgeUiStoreScope(),
          productNo,
          productName: $('kbProductName')?.value || '',
          detailDescription: $('kbDetail')?.value || '',
          specs: $('kbSpecs')?.value || '',
          usage: $('kbUsage')?.value || '',
          optionsCompat: $('kbOptions')?.value || '',
          cautions: $('kbCautions')?.value || '',
          extra: $('kbExtra')?.value || '',
          source: 'manual',
          trustStatus: 'approved',
        },
      });
      const okMsg = `저장됨 · 상품 #${data.item?.productNo || productNo}`;
      if (status) status.textContent = okMsg;
      setPageStatus(okMsg);
      if (window.KnowledgeManage?.refresh) void window.KnowledgeManage.refresh();
    } catch (err) {
      const msg = String(err?.message || err).slice(0, 240);
      if (status) status.textContent = msg;
      setPageStatus(msg, true);
      throw err;
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function loadProductKnowledgeToForm() {
    const status = $('kbStatus');
    try {
      const productNo = String($('kbProductNo')?.value || '').trim();
      if (!productNo) throw new Error('상품번호를 입력하세요.');
      const data = await fetchAuthApi(
        `/api/product-knowledge/${encodeURIComponent(productNo)}${knowledgeUiStoreQuery()}`
      );
      const item = data.item;
      if ($('kbProductName')) $('kbProductName').value = item.productName || '';
      if ($('kbDetail')) $('kbDetail').value = item.detailDescription || '';
      if ($('kbSpecs')) $('kbSpecs').value = item.specs || '';
      if ($('kbUsage')) $('kbUsage').value = item.usage || '';
      if ($('kbOptions')) $('kbOptions').value = item.optionsCompat || '';
      if ($('kbCautions')) $('kbCautions').value = item.cautions || '';
      if ($('kbExtra')) $('kbExtra').value = item.extra || '';
      if (status) status.textContent = `불러옴 · ${item.trustStatus || '-'}`;
      setPageStatus(`불러옴 · ${item.productName || productNo}`);
    } catch (err) {
      if (status) status.textContent = err.message || String(err);
      setPageStatus(err.message || String(err), true);
    }
  }

  async function deleteProductKnowledgeFromForm() {
    const status = $('kbStatus');
    try {
      const productNo = String($('kbProductNo')?.value || '').trim();
      if (!productNo) throw new Error('상품번호를 입력하세요.');
      if (!window.confirm(`상품 #${productNo} 지식을 삭제할까요?`)) return;
      const data = await fetchAuthApi(
        `/api/product-knowledge/${encodeURIComponent(productNo)}${knowledgeUiStoreQuery()}`,
        { method: 'DELETE', body: knowledgeUiStoreScope() }
      );
      if (!data?.deleted) throw new Error('삭제할 상품정보가 없습니다.');
      ['kbProductName', 'kbDetail', 'kbSpecs', 'kbUsage', 'kbOptions', 'kbCautions', 'kbExtra'].forEach((id) => {
        const el = $(id);
        if (el) el.value = '';
      });
      if (status) status.textContent = `삭제됨 · ${productNo}`;
      if (window.KnowledgeManage?.refresh) void window.KnowledgeManage.refresh();
    } catch (err) {
      if (status) status.textContent = err.message || String(err);
    }
  }

  async function saveStorePoliciesFromForm() {
    const status = $('kbStatus');
    const btn = $('policySaveBtn');
    if (btn?.disabled) return;
    try {
      if (btn) btn.disabled = true;
      if (status) status.textContent = '정책 저장 중…';
      await fetchAuthApi('/api/store-policies', {
        method: 'PUT',
        body: {
          ...knowledgeUiStoreScope(),
          shipping: $('policyShipping')?.value || '',
          exchangeReturn: $('policyExchange')?.value || '',
          refund: $('policyRefund')?.value || '',
          customerService: $('policyCs')?.value || '',
          source: 'manual',
          trustStatus: 'approved',
        },
      });
      if (status) status.textContent = '스토어 정책을 저장했습니다.';
      setPageStatus('스토어 정책을 저장했습니다.');
      if (window.KnowledgeManage?.refresh) void window.KnowledgeManage.refresh();
    } catch (err) {
      if (status) status.textContent = err.message || String(err);
      setPageStatus(err.message || String(err), true);
      throw err;
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function seedAmilyExampleKnowledge() {
    const status = $('kbStatus');
    const btn = $('kbSeedAmilyBtn');
    if (btn?.disabled) return;
    try {
      if (btn) btn.disabled = true;
      fillAmilyExampleKnowledgeForm();
      if (status) status.textContent = '예시 채움 → 저장 중…';
      await saveProductKnowledgeFromForm();
      await saveStorePoliciesFromForm();
      if (status) status.textContent = '아밀리 예시 상품·정책을 저장했습니다.';
    } catch (err) {
      if (status) status.textContent = err.message || String(err);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function refreshAuthBanner() {
    const banner = $('authBanner');
    if (!banner) return;
    try {
      if (typeof loadAuthSession !== 'function') {
        banner.classList.add('show');
        return;
      }
      const session = await loadAuthSession();
      banner.classList.toggle('show', !session?.token);
    } catch (_) {
      banner.classList.add('show');
    }
  }

  function bind() {
    window.fillProductKnowledgeForm = fillProductKnowledgeForm;
    $('kbSaveBtn')?.addEventListener('click', () => void saveProductKnowledgeFromForm());
    $('kbLoadBtn')?.addEventListener('click', () => void loadProductKnowledgeToForm());
    $('kbDeleteBtn')?.addEventListener('click', () => void deleteProductKnowledgeFromForm());
    $('policySaveBtn')?.addEventListener('click', () => void saveStorePoliciesFromForm());
    $('kbSeedAmilyBtn')?.addEventListener('click', () => void seedAmilyExampleKnowledge());
    $('pageRefreshBtn')?.addEventListener('click', () => {
      if (window.KnowledgeManage?.refresh) void window.KnowledgeManage.refresh();
    });
    $('pageCloseBtn')?.addEventListener('click', () => window.close());
    void refreshAuthBanner();
    if (window.KnowledgeManage?.refresh) void window.KnowledgeManage.refresh();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
