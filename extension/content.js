const NON_RETAILER_RE = /(?:^|\.)(?:google|googleapis|googleadservices|bing|yahoo|duckduckgo|baidu|yandex|youtube|facebook|instagram|twitter|x|tiktok|reddit|wikipedia|linkedin|pinterest|snapchat|netflix|spotify|twitch|discord|slack|notion|github|stackoverflow|medium|substack)\.[a-z.]{2,6}$/;

function isNonEuRetailer() {
  const host = location.hostname;
  if (NON_RETAILER_RE.test(host)) return false;
  return !/(\.ie|\.de|\.fr|\.nl|\.be|\.es|\.it|\.eu|\.at|\.pt|\.pl|\.se|\.dk|\.fi|\.cz|\.gr|\.ro|\.hu)$/.test(host);
}

function detectPageType() {
  const url = location.href;

  if (/\/(checkout|cart|basket|bag|order|pay)(\/|$|\?)/i.test(url)) return 'checkout';

  const hasProductUrl = /\/(product|products|item|items|goods|p|dp|pdp|detail|details)/i.test(url);
  const hasProductParam = /[?&](goods_id|product_id|productId|item_id|itemId|sku|pid|gid|asin|itm|iid)/i.test(url);
  const hasAddToCart = !!document.querySelector(
    '[data-action="add-to-cart"], button[name="add"], [class*="add-to-cart"], [class*="addToCart"], [class*="add_to_cart"], [id*="add-to-cart"], [aria-label*="add to cart" i], [aria-label*="add to bag" i], [aria-label*="add to basket" i], [data-qa*="add-to-cart" i], [data-testid*="add-to-cart" i]'
  );
  const hasProductSchema = !!document.querySelector('[itemtype*="schema.org/Product"]');
  const hasOgProduct = document.querySelector('meta[property="og:type"]')?.content === 'product';
  const hasPriceEl = !!document.querySelector('[itemprop="price"], [class*="price"], [data-price]');
  const hasH1 = !!document.querySelector('h1');

  if (hasProductUrl || hasProductParam || hasAddToCart || hasProductSchema || hasOgProduct || (hasPriceEl && hasH1)) return 'product';

  const hasShopUrl = /\/(shop|store|collection|category|catalog|sale|new-arrivals|men|women|clothing|shoes|bags|accessories)(\/|$|\?)/i.test(url);
  const hasManyPrices = document.querySelectorAll('[class*="price"], [itemprop="price"]').length > 2;
  if (hasShopUrl && hasManyPrices) return 'browse';

  return null;
}

async function init() {
  if (!isNonEuRetailer()) return;

  const domain = location.hostname;
  const iossResult = await window._pairlin_detectIOSS(domain);

  // Always show the detection banner on any non-EU retailer page
  window._pairlin_renderDetection(iossResult);

  // On checkout pages also run the basket watcher for full cost breakdown
  const pageType = detectPageType();
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