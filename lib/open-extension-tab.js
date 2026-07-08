/**
 * Extension page tab: focus existing tab or open a new one.
 * Duplicate tabs for the same page are closed to avoid confusion.
 */
function extensionTabUrlsMatch(a, b) {
  try {
    const left = new URL(a);
    const right = new URL(b);
    return (
      left.origin === right.origin &&
      left.pathname === right.pathname &&
      left.hash === right.hash
    );
  } catch {
    return a === b;
  }
}

function openOrFocusExtensionTab(pagePath, hash = '') {
  const baseUrl = chrome.runtime.getURL(pagePath);
  const targetUrl = `${baseUrl}${hash || ''}`;

  return new Promise((resolve) => {
    chrome.tabs.query({ url: `${baseUrl}*` }, (tabs) => {
      if (chrome.runtime.lastError || !tabs?.length) {
        chrome.tabs.create({ url: targetUrl }, resolve);
        return;
      }

      const sorted = [...tabs].sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
      const [primary, ...duplicates] = sorted;

      for (const dup of duplicates) {
        chrome.tabs.remove(dup.id);
      }

      const focusWindow = () => {
        chrome.windows.update(primary.windowId, { focused: true }, () => resolve(primary));
      };

      if (extensionTabUrlsMatch(primary.url || '', targetUrl)) {
        chrome.tabs.update(primary.id, { active: true }, focusWindow);
        return;
      }

      chrome.tabs.update(primary.id, { active: true, url: targetUrl }, focusWindow);
    });
  });
}
