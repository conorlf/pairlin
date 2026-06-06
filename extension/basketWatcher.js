let debounceTimer = null;
let lastBasketHash = '';

function hashItems(items) {
  return items.map(i => `${i.title}:${i.price}:${i.qty}`).join('|');
}

function detectCurrency() {
  const meta = document.querySelector('meta[itemprop="priceCurrency"]');
  if (meta) return meta.getAttribute('content') ?? 'USD';
  const text = document.body?.innerText ?? '';
  if (/£/.test(text)) return 'GBP';
  if (/€/.test(text)) return 'EUR';
  return 'USD';
}

function parsePrice(el) {
  if (!el) return 0;
  // Only trust content attribute on proper schema.org price elements
  if (el.getAttribute('itemprop') === 'price') {
    const c = el.getAttribute('content');
    if (c) {
      const n = parseFloat(c);
      if (n > 0 && n < 10000) return n;
    }
  }
  // Extract the first plausible price number from display text
  const text = (el.textContent ?? '').trim();
  const match = text.match(/\d{1,6}(?:,\d{3})*(?:\.\d{1,2})?/);
  if (!match) return 0;
  return parseFloat(match[0].replace(/,/g, '')) || 0;
}

function extractQty(row) {
  // 1. Numeric input (stepper / text field)
  const numInput = row.querySelector(
    'input[type="number"], input[name*="qty" i], input[name*="quantity" i]'
  );
  if (numInput) {
    const n = parseInt(numInput.value, 10);
    if (n > 0) return n;
  }

  // 2. Select dropdown (e.g. Qty: <select>)
  const selectEl = row.querySelector(
    'select[name*="qty" i], select[name*="quantity" i], select[class*="qty" i], select[class*="quantity" i]'
  );
  if (selectEl) {
    const n = parseInt(selectEl.value, 10);
    if (n > 0) return n;
  }

  // 3. Labelled span/div containing a digit — e.g. "Qty: 2", "Quantity: 1", "x2"
  const labelEl = row.querySelector(
    '[class*="qty" i], [class*="quantity" i], [data-testid*="qty" i], [aria-label*="quantity" i]'
  );
  if (labelEl) {
    const match = (labelEl.textContent ?? '').match(/\d+/);
    if (match) {
      const n = parseInt(match[0], 10);
      if (n > 0) return n;
    }
  }

  return 1;
}

function extractItems() {
  const items = [];

  const rows = document.querySelectorAll(
    '[class*="cart-item"], [class*="basket-item"], [class*="line-item"], [data-component="cart-item"]'
  );

  if (rows.length > 0) {
    for (const row of rows) {
      const title = (
        row.querySelector('[class*="title"], [class*="name"], [class*="product-name"]')?.textContent ??
        row.querySelector('a[href]')?.textContent ?? ''
      ).trim();

      const priceEl = row.querySelector('[itemprop="price"], [class*="price"]');
      const price = parsePrice(priceEl);
      const qty = extractQty(row);

      if (title && price > 0 && price < 10000) items.push({ title, price, currency: detectCurrency(), qty });
    }
  }

  // Deduplicate by title — handles mobile/desktop dual-render (qty already read from DOM, so first-wins is correct)
  const deduped = [];
  const seen = new Set();
  for (const item of items) {
    if (!seen.has(item.title)) {
      seen.add(item.title);
      deduped.push(item);
    }
  }
  const result = deduped.length > 0 ? deduped : items;

  // Fallback: single product page
  if (result.length === 0) {
    const title = (
      document.querySelector('h1')?.textContent ??
      document.querySelector('[itemprop="name"]')?.textContent ??
      document.querySelector('meta[property="og:title"]')?.getAttribute('content') ?? ''
    ).trim();
    const priceEl = document.querySelector('[itemprop="price"]');
    const price = parsePrice(priceEl);
    if (title && price > 0) result.push({ title, price, currency: detectCurrency(), qty: 1 });
  }

  return result;
}

async function onBasketChange(iossStatus) {
  const items = extractItems();
  if (items.length === 0) return;

  const hash = hashItems(items);
  if (hash === lastBasketHash) return;
  lastBasketHash = hash;

  try {
    const classifyResp = await fetch(`${BACKEND_URL}/api/classify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items, retailerDomain: location.hostname }),
    });
    const { items: classified } = await classifyResp.json();

    const classifiedWithPrices = classified.map((item, idx) => ({
      ...item,
      price: items[idx]?.price ?? 0,
      currency: items[idx]?.currency ?? 'USD',
      qty: items[idx]?.qty ?? 1,
    }));

    const estimateResp = await fetch(`${BACKEND_URL}/api/estimate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: classifiedWithPrices, retailerDomain: location.hostname, iossStatus }),
    });
    const estimate = await estimateResp.json();

    const itemsForOverlay = estimate.itemsClassified ?? classifiedWithPrices;

    window.dispatchEvent(new CustomEvent('pairlin:estimate', { detail: { estimate, items: itemsForOverlay, iossStatus } }));
  } catch (err) {
    console.warn('[Pairlin] estimate failed:', err);
  }
}

function startWatcher(iossStatus) {
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
