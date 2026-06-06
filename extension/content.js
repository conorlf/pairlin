const NON_RETAILER_RE = /(?:^|\.)(?:google|googleapis|googleadservices|bing|yahoo|duckduckgo|baidu|yandex|youtube|facebook|instagram|twitter|x|tiktok|reddit|wikipedia|linkedin|pinterest|snapchat|netflix|spotify|twitch|discord|slack|notion|github|stackoverflow|medium|substack)\.[a-z.]{2,6}$/;

function isNonEuRetailer() {
  const host = location.hostname;
  if (NON_RETAILER_RE.test(host)) return false;
  return !/(\.ie|\.de|\.fr|\.nl|\.be|\.es|\.it|\.eu|\.at|\.pt|\.pl|\.se|\.dk|\.fi|\.cz|\.gr|\.ro|\.hu)$/.test(host);
}

function detectPageType() {
  const url = location.href;

  if (/\/(checkout|cart|basket|bag|order|pay)(\/|$|\?)/i.test(url)) return 'checkout';

  const hasAddToCart = !!document.querySelector(
    '[data-action="add-to-cart"], button[name="add"], [class*="add-to-cart"], [class*="addToCart"], [class*="add_to_cart"], [id*="add-to-cart"], [aria-label*="add to cart" i], [aria-label*="add to bag" i], [aria-label*="add to basket" i], [data-qa*="add-to-cart" i], [data-testid*="add-to-cart" i]'
  );
  const hasProductSchema = !!document.querySelector('[itemtype*="schema.org/Product"]');
  const hasOgProduct = document.querySelector('meta[property="og:type"]')?.content === 'product';
  const hasProductUrl = /\/(product|products|item|items|p|dp|pdp|detail|details)\/./i.test(url);
  const hasPrice = !!document.querySelector(
    '[itemprop="price"], [class*="product-price"], [class*="ProductPrice"], [class*="product__price"], [class*="price--sale"], [data-testid*="price"]'
  );
  const hasPriceWithProductUrl = hasPrice && hasProductUrl;

  if (hasAddToCart || hasProductSchema || hasOgProduct || hasPriceWithProductUrl) return 'product';

  const hasShopUrl = /\/(shop|store|collection|category|catalog|sale|new-arrivals|men|women|clothing|shoes|bags|accessories)(\/|$|\?)/i.test(url);
  const hasManyPrices = document.querySelectorAll('[class*="price"], [itemprop="price"]').length > 2;
  if (hasShopUrl && hasManyPrices) return 'browse';

  return null;
}

async function init() {
  if (!isNonEuRetailer()) return;

  const pageType = detectPageType();
  if (!pageType) return;

  const domain = location.hostname;

  const iossResult = await window._pairlin_detectIOSS(domain);

  if (pageType === 'product' || pageType === 'browse') {
    window._pairlin_renderDetection(iossResult);
  }

  if (pageType === 'checkout') {
    window._pairlin_startWatcher(iossResult.status);
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
  window._pairlin_render(estimate, items, { status: iossStatus }, pendingOrderData);
});

init();