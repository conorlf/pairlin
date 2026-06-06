//const BACKEND_URL = 'http://localhost:3000';

let debounceTimer = null;
let lastBasketHash = '';

function hashItems(items) {
  return items.map(i => `${i.title}:${i.price}:${i.qty}`).join('|');
}

function extractItems() {
  const items = [];

  // Try structured cart rows first
  const rows = document.querySelectorAll(
    '[class*="cart-item"], [class*="basket-item"], [class*="line-item"], [data-component="cart-item"]'
  );

  if (rows.length > 0) {
    for (const row of rows) {
      const title = (
        row.querySelector('[class*="title"], [class*="name"], [class*="product-name"]')?.textContent ??
        row.querySelector('a[href]')?.textContent ?? ''
      ).trim();

      const priceEl = row.querySelector(
        '[class*="price"], [class*="total"], [itemprop="price"]'
      );
      const priceText = priceEl?.getAttribute('content') ?? priceEl?.textContent ?? '0';
      const price = parseFloat(priceText.replace(/[^0-9.]/g, '')) || 0;

      const qtyEl = row.querySelector('input[type="number"], [class*="quantity"], [class*="qty"]');
      const qty = parseInt(qtyEl?.value ?? qtyEl?.textContent ?? '1', 10) || 1;

      if (title && price > 0) items.push({ title, price, currency: detectCurrency(), qty });
    }
  }

  // Fallback: single product page
  if (items.length === 0) {
    const title = (
      document.querySelector('h1')?.textContent ??
      document.querySelector('[itemprop="name"]')?.textContent ??
      document.querySelector('meta[property="og:title"]')?.getAttribute('content') ?? ''
    ).trim();

    const priceEl = document.querySelector('[itemprop="price"]');
    const priceText = priceEl?.getAttribute('content') ?? priceEl?.textContent ?? '0';
    const price = parseFloat(priceText.replace(/[^0-9.]/g, '')) || 0;

    if (title && price > 0) items.push({ title, price, currency: detectCurrency(), qty: 1 });
  }

  return items;
}

function detectCurrency() {
  const meta = document.querySelector('meta[itemprop="priceCurrency"]');
  if (meta) return meta.getAttribute('content') ?? 'EUR';
  const text = document.body?.innerText ?? '';
  if (text.includes('£')) return 'GBP';
  if (text.includes('$')) return 'USD';
  return 'EUR';
}

async function onBasketChange(iossStatus) {
  const items = extractItems();
  if (items.length === 0) return;

  const hash = hashItems(items);
  if (hash === lastBasketHash) return;
  lastBasketHash = hash;

  try {
    // Classify items
    const classifyResp = await fetch(`${BACKEND_URL}/api/classify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items, retailerDomain: location.hostname }),
    });
    const { items: classified } = await classifyResp.json();

    // Get estimate + optimisation
    const estimateResp = await fetch(`${BACKEND_URL}/api/estimate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: classified, retailerDomain: location.hostname, iossStatus }),
    });
    const estimate = await estimateResp.json();

    // Fire custom event for overlay.js to consume
    window.dispatchEvent(new CustomEvent('pairlin:estimate', { detail: { estimate, items: classified, iossStatus } }));
  } catch (err) {
    console.warn('[Pairlin] estimate failed:', err);
  }
}

function startWatcher(iossStatus) {
  // Initial run
  onBasketChange(iossStatus);

  const observer = new MutationObserver(() => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => onBasketChange(iossStatus), 800);
  });

  const cartEl = document.querySelector(
    '[class*="cart"], [class*="basket"], [class*="bag"], main, #main, body'
  );
  observer.observe(cartEl ?? document.body, { childList: true, subtree: true, characterData: true });
}

window._pairlin_startWatcher = startWatcher;
window._pairlin_extractItems = extractItems;
