// Service worker — handles extension install, icon theming, and user storage

chrome.runtime.onInstalled.addListener(() => {
  console.log('[Pairlin] Extension installed');
});

function applyThemeIcon(dark) {
  const icon = dark ? 'darkicon.png' : 'lighticon.png';
  chrome.action.setIcon({
    path: { 16: icon, 32: icon, 48: icon, 128: icon },
  });
}

// Listen for messages from content script
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'SET_THEME') {
    applyThemeIcon(msg.dark);
    return false;
  }
  if (msg.type === 'GET_USER') {
    chrome.storage.local.get('pairlinUser', (data) => {
      sendResponse(data.pairlinUser ?? null);
    });
    return true;
  }
  if (msg.type === 'SET_USER') {
    chrome.storage.local.set({ pairlinUser: msg.user }, () => sendResponse(true));
    return true;
  }
});
