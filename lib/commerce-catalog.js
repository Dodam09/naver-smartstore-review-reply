/**
 * 커머스 상품정보 관리 UI — OAuth 연결 · 목록 sync · 상세 · 승인/거부
 * Client Secret은 연결 요청 시에만 서버로 전송하고 확장 storage에 저장하지 않음.
 * Access Token은 API 응답에 포함되지 않음.
 */
(function () {
  let selectedNo = null;
  let lastOauth = null;
  let syncInFlight = false;

  function $(id) {
    return document.getElementById(id);
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function setStatus(text) {
    const el = $('commerceCatalogStatus');
    if (el) el.textContent = text || '';
  }

  async function api(path, options = {}) {
    if (typeof fetchAuthApi !== 'function') {
      throw new Error('로그인이 필요합니다.');
    }
    return fetchAuthApi(path, options);
  }

  function selectedStoreId() {
    return String($('commerceStoreId')?.value || '').trim();
  }

  function updateSelectedStoreDisplay() {
    const el = $('commerceSelectedStoreDisplay');
    if (!el) return;
    const id = selectedStoreId();
    el.textContent = `현재 선택 store_id: ${id || '(기본)'}`;
  }

  function storeQs() {
    const storeId = selectedStoreId();
    return storeId ? `?storeId=${encodeURIComponent(storeId)}` : '';
  }

  function storeBody() {
    const storeId = selectedStoreId();
    return storeId ? { storeId } : {};
  }

  function setSyncButtonsDisabled(disabled) {
    const syncBtn = $('commerceCatalogSyncBtn');
    if (syncBtn) syncBtn.disabled = !!disabled;
  }

  function renderSyncStatus(sync) {
    const line = $('commerceSyncStatusLine');
    if (!line) return;
    if (!sync) {
      line.textContent = '동기화 상태: 확인 실패';
      return;
    }
    const running = !!(sync.running || sync.status === 'running');
    const parts = [
      `동기화 상태: ${sync.status || (running ? 'running' : 'idle')}`,
      running ? '진행 중' : '',
      sync.finishedAt ? `마지막 완료 ${sync.finishedAt}` : sync.startedAt ? `시작 ${sync.startedAt}` : '',
      sync.lastError ? `오류: ${sync.lastError}` : '',
      sync.products != null ? `상품 ${sync.products}` : '',
    ].filter(Boolean);
    line.textContent = parts.join(' · ');
  }

  /** Secret은 절대 storage에 쓰지 않음. 입력창만 즉시 비움. */
  function clearSecretInput() {
    const el = $('commerceClientSecret');
    if (el) el.value = '';
  }

  function assertNoSecretInStorageKeys() {
    // 방어: 실수로 storage에 secret 키가 생기면 삭제
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
    chrome.storage.local.get(null, (all) => {
      const bad = Object.keys(all || {}).filter((k) =>
        /client_secret|clientSecret|access_token|refresh_token|commerceSecret/i.test(k)
      );
      if (bad.length) chrome.storage.local.remove(bad);
    });
  }

  function renderOauthStatus(oauth) {
    lastOauth = oauth || null;
    const line = $('commerceOauthStatusLine');
    const matchEl = $('commerceOauthStoreMatch');
    if (!line) return;
    if (!oauth) {
      line.textContent = '연결 상태: 확인 실패';
      if (matchEl) matchEl.textContent = '';
      return;
    }
    const parts = [
      `연결 상태: ${oauth.status || '-'}`,
      oauth.connected ? '연결됨' : '미연결',
      oauth.clientId ? `Client ID ${oauth.clientId}` : '',
      oauth.hasClientSecret ? 'Secret(서버보관)' : '',
      oauth.expiresAt ? `만료 ${oauth.expiresAt}` : '',
      oauth.lastError ? `오류: ${oauth.lastError}` : '',
    ].filter(Boolean);
    line.textContent = parts.join(' · ');

    const selected = selectedStoreId();
    const connectedStore = String(oauth.storeId || '');
    if (matchEl) {
      if (!oauth.connected && oauth.status !== 'expired') {
        matchEl.textContent = '선택된 스토어와 연결 스토어를 확인한 뒤 연결하세요.';
      } else if (selected === connectedStore) {
        matchEl.textContent = `스토어 일치: "${selected || '(기본)'}"`;
      } else {
        matchEl.textContent = `주의: 선택 스토어 "${selected || '(기본)'}" ≠ 연결 스토어 "${connectedStore || '(기본)'}"`;
      }
    }

    if ($('commerceClientId') && oauth.clientId && !$('commerceClientId').value) {
      $('commerceClientId').value = oauth.clientId;
    }
  }

  function renderSummary(catalog) {
    const host = $('commerceCatalogSummary');
    if (!host) return;
    if (!catalog) {
      host.innerHTML = '<div class="hint">카탈로그를 불러오지 못했습니다.</div>';
      return;
    }
    const sync = catalog.sync || {};
    renderSyncStatus(sync);
    const saleCount = (catalog.items || []).filter((i) =>
      /SALE/i.test(String(i.listStatus || ''))
    ).length;
    const oosCount = (catalog.items || []).filter((i) =>
      /OUTOFSTOCK/i.test(String(i.listStatus || ''))
    ).length;
    host.innerHTML = `
      <div class="knowledge-summary-grid">
        <span>등록 상품 ${catalog.catalogCount || 0}</span>
        <span>지식 행 ${catalog.knowledgeCount || 0}</span>
        <span>목록 sync ${escapeHtml(sync.status || (sync.running ? 'running' : 'idle'))}</span>
        <span>마지막 sync ${escapeHtml(sync.finishedAt || sync.startedAt || '-')}</span>
        <span>SALE ${saleCount}</span>
        <span>OUTOFSTOCK ${oosCount}</span>
        <span>상세 수집됨 ${
          (catalog.items || []).filter((i) => i.detailFetched).length
        }</span>
        <span>충돌 ${
          (catalog.items || []).reduce((n, i) => n + (i.conflictCount || 0), 0)
        }</span>
        <span>상세 실패 ${
          (catalog.items || []).filter((i) => i.detailFetched && !i.detailOk).length
        }</span>
      </div>`;
  }

  function renderList(items) {
    const host = $('commerceCatalogList');
    if (!host) return;
    if (!items?.length) {
      host.innerHTML =
        '<div class="hint">동기화된 상품이 없습니다. 「목록 동기화」 또는 문의 상품 상세 수집을 실행하세요.</div>';
      return;
    }
    host.innerHTML = items
      .map((item) => {
        const active = item.channelProductNo === selectedNo ? ' active' : '';
        const detail = item.detailFetched
          ? item.detailOk
            ? '상세OK'
            : '상세실패'
          : '상세없음';
        const conflict = item.conflictCount ? ` · 충돌${item.conflictCount}` : '';
        return `<button type="button" class="knowledge-entry-item${active}" data-channel-no="${escapeHtml(
          item.channelProductNo
        )}">
          <div class="ke-title">${escapeHtml(item.productName || '(이름 없음)')} · #${escapeHtml(
          item.channelProductNo
        )}</div>
          <div class="ke-meta">${escapeHtml(item.listStatus || '-')} · ${detail} · ${escapeHtml(
          item.knowledgeTrust || item.knowledgeSource || '-'
        )}${conflict}${item.manualOnly ? ' · 수동KB' : ''}</div>
        </button>`;
      })
      .join('');

    host.querySelectorAll('[data-channel-no]').forEach((btn) => {
      btn.addEventListener('click', () => {
        selectedNo = btn.getAttribute('data-channel-no');
        const item = items.find((i) => i.channelProductNo === selectedNo);
        fillDetail(item);
        host.querySelectorAll('.knowledge-entry-item').forEach((el) => {
          el.classList.toggle('active', el.getAttribute('data-channel-no') === selectedNo);
        });
      });
    });
  }

  function fillDetail(item) {
    const card = $('commerceProductDetailCard');
    if (!card) return;
    if (!item) {
      card.hidden = true;
      return;
    }
    card.hidden = false;
    if ($('commerceProductDetailTitle')) {
      $('commerceProductDetailTitle').textContent =
        item.productName || `상품 #${item.channelProductNo}`;
    }
    if ($('commerceProductDetailMeta')) {
      $('commerceProductDetailMeta').textContent = [
        `#${item.channelProductNo}`,
        item.originProductNo ? `origin ${item.originProductNo}` : '',
        `목록 ${item.listStatus || '-'}`,
        item.detailFetched
          ? `상세 ${item.detailOk ? '성공' : '실패'} @ ${item.detailFetchedAt || '-'}`
          : '상세 미수집',
        item.detailError ? `오류: ${item.detailError}` : '',
        `출처 ${item.knowledgeSource || '-'}`,
        `검증 ${item.knowledgeTrust || '-'}`,
      ]
        .filter(Boolean)
        .join(' · ');
    }

    const fieldsHost = $('commerceProductFields');
    if (!fieldsHost) return;
    const fields = item.fields || [];
    if (!fields.length) {
      fieldsHost.innerHTML = '<div class="hint">표시할 필드가 없습니다. 상세 수집을 실행하세요.</div>';
      return;
    }
    fieldsHost.innerHTML = fields
      .map((f) => {
        const conflictBlock = f.conflict
          ? `<div class="hint" style="color:#b45309;">충돌 · 수집값: ${escapeHtml(
              String(f.scrapedValue || '').slice(0, 200)
            )}</div>`
          : '';
        const usable = f.usableAsFact ? '확정근거 가능' : '확정근거 불가';
        return `<div class="commerce-field-row" style="border-top:1px solid var(--border); padding:8px 0;" data-field="${escapeHtml(
          f.field
        )}">
          <div><strong>${escapeHtml(f.field)}</strong> · ${escapeHtml(f.trustStatus)} · ${escapeHtml(
          f.source
        )} · ${usable}</div>
          <div class="hint" style="white-space:pre-wrap;">${escapeHtml(f.valuePreview)}</div>
          ${conflictBlock}
          <div class="row-inline" style="gap:6px; margin-top:4px;">
            <button type="button" class="secondary commerce-approve-btn" data-field="${escapeHtml(
              f.field
            )}">승인</button>
            <button type="button" class="secondary commerce-reject-btn" data-field="${escapeHtml(
              f.field
            )}">거부</button>
          </div>
        </div>`;
      })
      .join('');

    fieldsHost.querySelectorAll('.commerce-approve-btn').forEach((btn) => {
      btn.addEventListener('click', () =>
        void approveField(item.channelProductNo, btn.getAttribute('data-field'))
      );
    });
    fieldsHost.querySelectorAll('.commerce-reject-btn').forEach((btn) => {
      btn.addEventListener('click', () =>
        void rejectField(item.channelProductNo, btn.getAttribute('data-field'))
      );
    });
  }

  async function refreshOauthStatus() {
    try {
      const data = await api(`/api/commerce/oauth/status${storeQs()}`);
      renderOauthStatus(data.oauth);
      const blob = JSON.stringify(data);
      if (/client_secret|access_token|refresh_token/i.test(blob) && /:\s*"[^"\[]{8,}/.test(blob)) {
        setStatus('경고: 응답에 민감값 형태가 감지되었습니다. 서버 응답을 점검하세요.');
      }
    } catch (err) {
      renderOauthStatus(null);
      setStatus(err.message || String(err));
    }
  }

  async function connectOauth() {
    const clientId = String($('commerceClientId')?.value || '').trim();
    const clientSecret = String($('commerceClientSecret')?.value || '');
    try {
      setStatus('연결 중…');
      const body = {
        ...storeBody(),
        type: 'SELF',
        clientId,
        clientSecret,
      };
      const data = await api('/api/commerce/oauth/connect', { method: 'POST', body });
      assertNoSecretInStorageKeys();
      renderOauthStatus(data.oauth);
      setStatus(data.oauth?.connected ? '연결되었습니다.' : data.oauth?.lastError || '연결 응답 확인');
      await refresh();
    } catch (err) {
      setStatus(err.message || String(err));
      await refreshOauthStatus();
    } finally {
      // Secret은 성공·실패·예외와 무관하게 즉시 비움 (확장에 잔존 금지)
      clearSecretInput();
      assertNoSecretInStorageKeys();
    }
  }

  async function reissueOauth() {
    try {
      setStatus('토큰 재발급 중…');
      // Secret 재입력 없이 서버 보관 암호문으로 재발급
      const data = await api('/api/commerce/oauth/reissue', {
        method: 'POST',
        body: { ...storeBody() },
      });
      clearSecretInput();
      renderOauthStatus(data.oauth);
      setStatus('토큰을 재발급했습니다.');
    } catch (err) {
      setStatus(err.message || String(err));
      await refreshOauthStatus();
    }
  }

  async function disconnectOauth() {
    if (!window.confirm('이 스토어의 커머스 연결을 해제할까요?')) return;
    try {
      setStatus('연결 해제 중…');
      const data = await api('/api/commerce/oauth/disconnect', {
        method: 'POST',
        body: { ...storeBody() },
      });
      clearSecretInput();
      renderOauthStatus(data.oauth);
      setStatus('연결을 해제했습니다.');
    } catch (err) {
      setStatus(err.message || String(err));
    }
  }

  async function syncCatalog() {
    if (syncInFlight) {
      setStatus('상품 목록 동기화가 이미 진행 중입니다.');
      return;
    }
    syncInFlight = true;
    setSyncButtonsDisabled(true);
    try {
      setStatus('상품 목록 동기화 중…');
      renderSyncStatus({ status: 'running', running: true, startedAt: new Date().toISOString() });
      const data = await api('/api/commerce/products/sync', {
        method: 'POST',
        body: { ...storeBody() },
      });
      renderSyncStatus(data.sync || { status: 'idle', finishedAt: new Date().toISOString() });
      setStatus('상품 목록 동기화 완료');
      await refresh();
    } catch (err) {
      const msg = err.message || String(err);
      const code = err.code || err?.data?.code || '';
      if (code === 'SYNC_IN_PROGRESS' || /진행|in progress|409/i.test(msg)) {
        setStatus('동기화가 이미 진행 중입니다. 완료 후 다시 시도하세요.');
        renderSyncStatus({ status: 'running', running: true, lastError: msg });
      } else {
        setStatus(msg);
        renderSyncStatus({ status: 'failed', lastError: msg });
      }
      await refresh();
    } finally {
      syncInFlight = false;
      setSyncButtonsDisabled(false);
    }
  }

  async function refresh() {
    try {
      updateSelectedStoreDisplay();
      setStatus('불러오는 중…');
      await refreshOauthStatus();
      const data = await api(`/api/commerce/products/catalog${storeQs()}`);
      const catalog = data.catalog;
      renderSummary(catalog);
      renderList(catalog?.items || []);
      if (selectedNo) {
        const still = (catalog?.items || []).find((i) => i.channelProductNo === selectedNo);
        fillDetail(still || null);
        if (!still) selectedNo = null;
      }
      setStatus('');
    } catch (err) {
      renderSummary(null);
      renderList([]);
      renderSyncStatus(null);
      setStatus(err.message || String(err));
    }
  }

  async function fetchDetail() {
    const no = selectedNo || String($('commerceDetailProductNo')?.value || '').replace(/[^\d]/g, '');
    if (!no) {
      setStatus('상품번호를 선택하거나 입력하세요.');
      return;
    }
    try {
      setStatus('상세 수집 중…');
      selectedNo = no;
      await api('/api/commerce/products/detail', {
        method: 'POST',
        body: { ...storeBody(), channelProductNo: no, force: !!$('commerceDetailForce')?.checked },
      });
      setStatus('상세 수집 완료');
      await refresh();
    } catch (err) {
      setStatus(err.message || String(err));
      await refresh();
    }
  }

  async function approveField(productNo, field) {
    try {
      setStatus(`승인 중… ${field}`);
      await api(
        `/api/commerce/products/${encodeURIComponent(productNo)}/fields/${encodeURIComponent(field)}/approve`,
        { method: 'POST', body: { ...storeBody(), useScraped: true } }
      );
      setStatus('승인했습니다. 확정 근거로 사용할 수 있습니다.');
      await refresh();
    } catch (err) {
      setStatus(err.message || String(err));
    }
  }

  async function rejectField(productNo, field) {
    try {
      setStatus(`거부 중… ${field}`);
      await api(
        `/api/commerce/products/${encodeURIComponent(productNo)}/fields/${encodeURIComponent(field)}/reject`,
        { method: 'POST', body: { ...storeBody() } }
      );
      setStatus('거부 처리했습니다.');
      await refresh();
    } catch (err) {
      setStatus(err.message || String(err));
    }
  }

  function bind() {
    assertNoSecretInStorageKeys();
    updateSelectedStoreDisplay();
    $('commerceCatalogRefreshBtn')?.addEventListener('click', () => void refresh());
    $('commerceCatalogSyncBtn')?.addEventListener('click', () => void syncCatalog());
    $('commerceDetailFetchBtn')?.addEventListener('click', () => void fetchDetail());
    $('commerceOauthConnectBtn')?.addEventListener('click', () => void connectOauth());
    $('commerceOauthReissueBtn')?.addEventListener('click', () => void reissueOauth());
    $('commerceOauthDisconnectBtn')?.addEventListener('click', () => void disconnectOauth());
    $('commerceOauthRefreshStatusBtn')?.addEventListener('click', () => void refreshOauthStatus());
    $('commerceStoreId')?.addEventListener('input', () => updateSelectedStoreDisplay());
    $('commerceStoreId')?.addEventListener('change', () => {
      updateSelectedStoreDisplay();
      void refreshOauthStatus();
      void refresh();
    });
  }

  window.CommerceCatalog = {
    refresh,
    bind,
    refreshOauthStatus,
    connectOauth,
    syncCatalog,
    getLastOauth: () => lastOauth,
  };

  /** 상품정보 자동수집 UI 보류 — #commerceCatalogCard 가 hidden 이면 바인딩 생략 */
  function shouldBindCommerceUi() {
    const card = $('commerceCatalogCard');
    return !!(card && !card.hidden);
  }

  if (shouldBindCommerceUi()) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', bind);
    } else {
      bind();
    }
  }
})();
