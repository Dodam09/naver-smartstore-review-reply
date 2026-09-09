/**
 * Work-tab chrome: open the extension side panel from a full page.
 */
(function initAppShell() {
  function openSidePanel() {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return;
    chrome.runtime.sendMessage({ type: 'OPEN_SIDE_PANEL' }, () => {
      void chrome.runtime.lastError;
    });
  }

  document.addEventListener('click', (event) => {
    const btn = event.target?.closest?.('[data-open-side-panel]');
    if (!btn) return;
    event.preventDefault();
    openSidePanel();
  });
})();
