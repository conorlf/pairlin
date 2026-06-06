//const BACKEND_URL = 'https://your-backend.up.railway.app';
//const CHECKOUT_URL = 'https://app.pairlin.io/checkout';

function fmt(n) { return '€' + Number(n).toFixed(2); }
function conf(c) { return `<span class="lc-conf" title="AI confidence">${c}%</span>`; }

function removeExisting() {
  document.getElementById('pairlin-overlay')?.remove();
}

function inject(html) {
  removeExisting();
  const div = document.createElement('div');
  div.id = 'pairlin-overlay';
  div.innerHTML = html;
  document.body.appendChild(div);

  div.querySelector('.lc-close')?.addEventListener('click', () => div.remove());
  div.querySelector('.lc-minimize')?.addEventListener('click', () => {
    const body = div.querySelector('.lc-body');
    if (body) body.style.display = body.style.display === 'none' ? '' : 'none';
  });
}

function storePendingOrder(payload) {
  chrome.storage.local.set({ pendingOrder: payload });
}

// Feature 1 — IOSS detection result banner
function renderDetection(result) {
  const { status, confidence } = result;
  const isIoss = status === 'ioss';
  const isUnknown = status === 'unknown';

  const icon = isIoss ? '✓' : isUnknown ? '⚠️' : '🚨';
  const cls = isIoss ? 'lc-green' : isUnknown ? 'lc-amber' : 'lc-red';
  const label = isIoss
    ? 'HIGH CONFIDENCE — IOSS Registered'
    : isUnknown
    ? `MEDIUM CONFIDENCE — Possibly IOSS (${confidence}% confidence)`
    : `HIGH CONFIDENCE — Not IOSS Registered`;

  const desc = isIoss
    ? 'This retailer collects VAT and customs at checkout.'
    : isUnknown
    ? `Some signals present but unclear. There is a ${100 - confidence}% chance customs charges may apply on delivery.`
    : `This retailer does not collect VAT or customs. There is an ${confidence}% chance you will receive a customs charge after delivery.`;

  inject(`
    <div class="lc-widget ${cls}">
      <div class="lc-header">
        <span>${icon} ${label}</span>
        <span class="lc-minimize" title="Minimise">─</span>
        <span class="lc-close" title="Close">✕</span>
      </div>
      <div class="lc-body">
        <p class="lc-desc">${desc}</p>
        <p class="lc-footer">Powered by Pairlin</p>
      </div>
    </div>
  `);
}

// Feature 2 — IOSS true cost + tariff heading breakdown
function renderIossCostDisplay(estimate, items, pendingOrderData) {
  const { baseScenario, distinctHsChapters, optimisation } = estimate;
  const { basketTotal, duty, vat, serviceFee, total } = baseScenario;

  const rows = items.map(i =>
    `<div class="lc-line">
      <span>${i.title} <span class="lc-cat">${i.hsDescription}</span></span>
      <span>${fmt(i.price_eur * i.qty)}</span>
    </div>`
  ).join('');

  const dutyRows = items.map(i =>
    `<div class="lc-line lc-indent">
      <span>└── ${i.hsDescription} +${fmt(3)} ${conf(i.confidence)}</span>
    </div>`
  ).join('');

  const protectBtn = `<button class="lc-btn lc-btn-secondary" id="lc-protect">Protect this order — €1.99</button>`;
  const skipBtn = `<button class="lc-btn lc-btn-ghost" id="lc-skip">Continue without cover</button>`;

  inject(`
    <div class="lc-widget lc-green">
      <div class="lc-header">
        <span>✓ IOSS Registered — True Cost Breakdown</span>
        <span class="lc-minimize">─</span><span class="lc-close">✕</span>
      </div>
      <div class="lc-body">
        ${rows}
        <div class="lc-divider"></div>
        <div class="lc-line"><span>Subtotal</span><span>${fmt(basketTotal)}</span></div>
        <div class="lc-section-label">EU Customs Duty — ${distinctHsChapters} tariff heading${distinctHsChapters > 1 ? 's' : ''} detected:</div>
        ${dutyRows}
        <div class="lc-line"><span>Total customs duty</span><span>+${fmt(duty)}</span></div>
        <div class="lc-line"><span>VAT 23%</span><span>+${fmt(vat)}</span></div>
        <div class="lc-divider"></div>
        <div class="lc-line lc-total"><span>True landed cost</span><span>${fmt(total)}</span></div>
        <p class="lc-note">ℹ️ Confidence scores reflect AI estimates. Actual tariff headings determined by customs.</p>
        <div class="lc-alert lc-amber">
          <strong>⚠️ Even IOSS parcels can be unexpectedly held</strong> at Irish customs due to system errors or spot checks.
          With Pairlin we monitor your order email and handle payment immediately.
        </div>
        ${protectBtn}${skipBtn}
        <p class="lc-footer">Powered by Pairlin</p>
      </div>
    </div>
  `);

  document.getElementById('lc-protect')?.addEventListener('click', () => {
    storePendingOrder({ ...pendingOrderData, iossProtection: true, estimates: { baseScenario: { ...baseScenario, serviceFee: 1.99, total: total - serviceFee + 1.99 } } });
    window.location.href = `${CHECKOUT_URL}?ref=${encodeURIComponent(location.href)}`;
  });

  document.getElementById('lc-skip')?.addEventListener('click', () => {
    removeExisting();
  });
}

// Feature 3 / 4 — Non-IOSS or >€150 full service
function renderFullService(estimate, items, iossStatus, pendingOrderData) {
  const { baseScenario, holdProbability, estimatedDelay, optimisation, isOver150 } = estimate;
  const { basketTotal, duty, vat, courierHandling, serviceFee, total } = baseScenario;

  const isOver = isOver150;
  const icon = '🚨';
  const header = isOver
    ? `🚨 Customs Threshold Exceeded — ${fmt(basketTotal)}`
    : `🚨 Customs Alert — Not IOSS Registered`;
  const subtext = isOver
    ? `Your basket is over the €150 threshold. IOSS no longer applies — full customs duty and VAT will be charged at the Irish border.`
    : `This retailer does not collect VAT or customs. There is an ${holdProbability}% chance you will receive a customs charge after delivery.`;

  const itemRows = items.map(i =>
    `<div class="lc-line lc-indent">
      <span>└── ${i.title} (${i.hsDescription})</span>
      <span>Duty ${(i.dutyRate * 100).toFixed(0)}% ${conf(i.confidence)}</span>
    </div>`
  ).join('');

  const withoutTotal = basketTotal + duty + vat + (courierHandling ?? 6);
  const withSaving = ((courierHandling ?? 6) - serviceFee).toFixed(2);
  const savingNote = parseFloat(withSaving) > 0 ? `saves ${fmt(withSaving)} vs courier handling` : '';

  const arbitragePanel = renderArbitragePanel(optimisation, pendingOrderData);

  inject(`
    <div class="lc-widget lc-red">
      <div class="lc-header">
        <span>${header}</span>
        <span class="lc-minimize">─</span><span class="lc-close">✕</span>
      </div>
      <div class="lc-body">
        <p class="lc-desc">${subtext}</p>
        ${itemRows}
        <div class="lc-divider"></div>
        <div class="lc-line"><span>Your basket</span><span>${fmt(basketTotal)}</span></div>
        <div class="lc-line"><span>Customs duty</span><span>~${fmt(duty)}</span></div>
        <div class="lc-line"><span>VAT 23%</span><span>~${fmt(vat)}</span></div>
        <div class="lc-line"><span>An Post handling</span><span>~${fmt(courierHandling ?? 6)}</span></div>
        ${estimatedDelay ? `<div class="lc-line"><span>Estimated delay</span><span>${estimatedDelay}</span></div>` : ''}
        <div class="lc-divider"></div>
        <div class="lc-comparison">
          <div class="lc-col">
            <div class="lc-col-label">Without Pairlin</div>
            <div>Pay now: ${fmt(basketTotal)}</div>
            <div>Pay at border: ~${fmt(duty + vat + (courierHandling ?? 6))}</div>
            <div class="lc-col-total">Total: ~${fmt(withoutTotal)}</div>
            <div>+ ${estimatedDelay ?? '10-14 days'} delay</div>
          </div>
          <div class="lc-col lc-col-right">
            <div class="lc-col-label">With Pairlin</div>
            <div>Pay once now: ${fmt(total)}</div>
            <div class="lc-indent">└── Items: ${fmt(basketTotal)}</div>
            <div class="lc-indent">└── Est. customs: ~${fmt(duty + vat)}</div>
            <div class="lc-indent">└── Fee: ${fmt(serviceFee)}${savingNote ? ` (${savingNote})` : ''}</div>
            <div class="lc-col-total">No delays. No surprises.</div>
          </div>
        </div>
        ${arbitragePanel}
        <button class="lc-btn" id="lc-pay">Pay once with Pairlin — ${fmt(total)}</button>
        <button class="lc-btn lc-btn-ghost" id="lc-proceed">Proceed without cover</button>
        <p class="lc-footer">Powered by Pairlin · Surplus refunded automatically</p>
      </div>
    </div>
  `);

  document.getElementById('lc-pay')?.addEventListener('click', () => {
    storePendingOrder(pendingOrderData);
    window.location.href = `${CHECKOUT_URL}?ref=${encodeURIComponent(location.href)}`;
  });
  document.getElementById('lc-proceed')?.addEventListener('click', removeExisting);
}

// Feature 5 — Arbitrage panel (appended to other overlays or standalone)
function renderArbitragePanel(optimisation, pendingOrderData) {
  if (!optimisation) return '';

  const { recommended, saving, explanation, suggestedCategories } = optimisation;

  if (recommended === 'split' && saving > 1) {
    return `
      <div class="lc-alert lc-green-alert">
        <strong>💰 Save ${fmt(saving)} on this order</strong><br>
        ${explanation}
        <button class="lc-btn lc-btn-sm" id="lc-split">Split my order and save ${fmt(saving)}</button>
      </div>`;
  }

  if (recommended === 'consolidate') {
    const cats = suggestedCategories?.join(', ') ?? 'same category';
    return `
      <div class="lc-alert lc-blue-alert">
        <strong>⚡ Keep everything in one order</strong><br>
        ${explanation}
        <p class="lc-note">💡 Adding more ${cats} costs no additional customs duty.</p>
      </div>`;
  }

  if (recommended === 'warn_threshold') {
    return `
      <div class="lc-alert lc-amber-alert">
        <strong>💡 Threshold Alert</strong><br>
        ${explanation}
        <button class="lc-btn lc-btn-sm lc-btn-amber" id="lc-place-now">Place this order now</button>
      </div>`;
  }

  return '';
}

// Main render dispatcher
function render(estimate, items, iossResult, pendingOrderData) {
  const { status } = iossResult;
  const { isOver150 } = estimate;

  // Attach split handler if present
  window.dispatchEvent(new CustomEvent('pairlin:rendered'));

  setTimeout(() => {
    document.getElementById('lc-split')?.addEventListener('click', () => {
      const splitData = { ...pendingOrderData, chosenStrategy: 'split', estimates: { ...estimate, splits: estimate.optimisation?.splits } };
      storePendingOrder(splitData);
      window.location.href = `${CHECKOUT_URL}?ref=${encodeURIComponent(location.href)}`;
    });
    document.getElementById('lc-place-now')?.addEventListener('click', () => {
      storePendingOrder(pendingOrderData);
      window.location.href = `${CHECKOUT_URL}?ref=${encodeURIComponent(location.href)}`;
    });
  }, 100);

  if (isOver150) {
    renderFullService(estimate, items, status, pendingOrderData);
  } else if (status === 'ioss') {
    renderIossCostDisplay(estimate, items, pendingOrderData);
  } else {
    // not_ioss or unknown — show full service overlay
    renderFullService(estimate, items, status, pendingOrderData);
  }
}

window._pairlin_render = render;
window._pairlin_renderDetection = renderDetection;
