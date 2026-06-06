//const BACKEND_URL = 'http://localhost:3000';

function detectPageType() {
  const url = location.href;
  const hasCheckout = /\/(checkout|cart|basket|bag|order|pay)(\/|$|\?)/i.test(url);
  const hasAddToCart = !!document.querySelector(
    '[data-action="add-to-cart"], button[name="add"], [class*="add-to-cart"], [class*="addToCart"]'
  );
  if (hasCheckout) return 'checkout';
  if (hasAddToCart) return 'product';
  return 'browse';
}

function isNonEuRetailer() {
  const host = location.hostname;
  return !/(\.ie|\.de|\.fr|\.nl|\.be|\.es|\.it|\.eu|\.at|\.pt|\.pl|\.se|\.dk|\.fi|\.cz|\.gr|\.ro|\.hu)$/.test(host);
}

async function init() {
  if (!isNonEuRetailer()) return;

  const pageType = detectPageType();
  const domain = location.hostname;

  // Feature 1: IOSS detection on all page types
  const iossResult = await window._landedcost_detectIOSS(domain);

  if (pageType === 'product' || pageType === 'browse') {
    window._landedcost_renderDetection(iossResult);
  }

  if (pageType === 'checkout') {
    window._landedcost_startWatcher(iossResult.status);
  }
}

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

init();
