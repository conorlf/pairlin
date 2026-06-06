function detectPageType() {
  const url = location.href;

  // Checkout / cart pages — URL is the strongest signal
  if (/\/(checkout|cart|basket|bag|order|pay)(\/|$|\?)/i.test(url)) return 'checkout';

  // Product pages — add-to-cart button or structured product data
  const hasAddToCart = !!document.querySelector(
    '[data-action="add-to-cart"], button[name="add"], [class*="add-to-cart"], [class*="addToCart"], [class*="add_to_cart"], [id*="add-to-cart"]'
  );
  const hasProductSchema = !!document.querySelector('[itemtype*="schema.org/Product"]');
  const hasOgProduct = document.querySelector('meta[property="og:type"]')?.content === 'product';
  if (hasAddToCart || hasProductSchema || hasOgProduct) return 'product';

  // Collection / category pages — shopping URL segment + multiple price elements
  const hasShopUrl = /\/(shop|store|collection|category|catalog|sale|new-arrivals|men|women|clothing|shoes|bags|accessories)(\/|$|\?)/i.test(url);
  const hasManyPrices = document.querySelectorAll('[class*="price"], [itemprop="price"]').length > 2;
  if (hasShopUrl && hasManyPrices) return 'browse';

  return null; // Not a shopping page — don't activate
}
