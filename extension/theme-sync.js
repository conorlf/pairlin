// Runs in isolated world — has access to chrome.runtime
// Detects OS dark/light preference and tells the background script which icon to show.
(function () {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');

  function send(dark) {
    chrome.runtime.sendMessage({ type: 'SET_THEME', dark }).catch(() => {});
  }

  send(mq.matches);
  mq.addEventListener('change', (e) => send(e.matches));
})();
