// Service worker — handles extension install and icon badge

chrome.runtime.onInstalled.addListener(() => {
  console.log('[Pairlin] Extension installed');
});

// Listen for messages from content script
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
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
