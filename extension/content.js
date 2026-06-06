// LandedCost content script — orchestrates all 5 features

const BACKEND_URL = 'https://your-backend.up.railway.app';

function detectPageType() {
  const url = location.href;
  const hasCheckout = /\/(checkout|cart|basket|bag|order|pay)(\/|$|\?)/i.test(url);
  const hasAddToCart = !!document.querySelector(
    '[data-action="add-to-cart"], button[name="add"], [class*="add-to-cart"], [class*="addToCart"]'
  );
  if (hasCheckout) return 'checkout';
  if (hasAddToCart) return 'product';
  return null;
}

function isNonEuRetailer() {
  // Basic heuristic — skip .ie/.de/.fr/.nl/.eu domains
  const host = location.hostname;
  return !/(\.ie|\.de|\.fr|\.nl|\.be|\.es|\.it|\.eu|\.at|\.pt|\.pl|\.se|\.dk|\.fi|\.cz|\.gr|\.ro|\.hu)$/.test(host);
}

async function init() {
  if (!isNonEuRetailer()) return;

  const pageType = detectPageType();
  if (!pageType) return;

  const domain = location.hostname;

  // Feature 1: IOSS detection (runs on all page types)
  const iossResult = await window._landedcost_detectIOSS(domain);

  // Show detection banner on product pages
  if (pageType === 'product') {
    window._landedcost_renderDetection(iossResult);
  }

  // Features 2-5: activate on checkout/cart pages
  if (pageType === 'checkout') {
    window._landedcost_startWatcher(iossResult.status);
  }
}

// Load sub-scripts then run
function loadScript(src) {
  return new Promise(resolve => {
    const s = document.createElement('script');
    s.src = chrome.runtime.getURL(src);
    s.onload = resolve;
    document.head.appendChild(s);
  });
}

(async () => {
  await loadScript('iossDetector.js');
  await loadScript('basketWatcher.js');
  await loadScript('overlay.js');

  // Listen for estimate events from basketWatcher
  window.addEventListener('landedcost:estimate', (e) => {
    const { estimate, items, iossStatus } = e.detail;
    const pendingOrderData = {
      retailerUrl: location.href,
      retailerDomain: location.hostname,
      items,
      iossStatus,
      chosenStrategy: 'keep',
      estimates: estimate,
    };
    window._landedcost_render(estimate, items, { status: iossStatus }, pendingOrderData);
  });

  await init();
})();
