import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { detectRouter } from './routes/detect';
import { classifyRouter } from './routes/classify';
import { estimateRouter } from './routes/estimate';
import { ordersRouter } from './routes/orders';
import { usersRouter } from './routes/users';
import { mollieWebhookRouter } from './routes/webhooks/mollie';
import { emailWebhookRouter } from './routes/webhooks/email';
import { initVectorStore } from './services/vectorStore';

const app = express();
const PORT = process.env.PORT ?? 3000;

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

app.use('/api/detect', detectRouter);
app.use('/api/classify', classifyRouter);
app.use('/api/estimate', estimateRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/users', usersRouter);
app.use('/webhooks/mollie', mollieWebhookRouter);
app.use('/webhooks/email', emailWebhookRouter);

app.get('/health', (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// Checkout page
app.get('/checkout', (_req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Pairlin — Secure Checkout</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:system-ui,-apple-system,sans-serif;background:#f5f5f5;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:16px}
    .card{background:#fff;border-radius:16px;padding:32px;width:100%;max-width:420px;box-shadow:0 4px 24px rgba(0,0,0,.08)}
    .logo{font-size:1.5rem;font-weight:700;color:#111;margin-bottom:4px}
    .tagline{color:#666;font-size:.875rem;margin-bottom:24px}
    .retailer{background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:10px 14px;font-size:.85rem;color:#166534;margin-bottom:20px}
    .line{display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #f0f0f0;font-size:.9rem;color:#444}
    .divider{height:1px;background:#e5e5e5;margin:4px 0}
    .total-row{display:flex;justify-content:space-between;padding:14px 0 0;font-weight:700;font-size:1.05rem;color:#111}
    .total-amount{font-size:1.3rem;color:#16a34a}
    .section-label{font-size:.75rem;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:#888;margin:20px 0 8px}
    input{width:100%;padding:12px 14px;border:1.5px solid #e5e5e5;border-radius:8px;font-size:.95rem;outline:none;transition:border-color .2s}
    input:focus{border-color:#16a34a}
    input.err{border-color:#ef4444}
    .btn{display:block;width:100%;margin-top:16px;padding:14px;background:#111;color:#fff;border:none;border-radius:10px;font-size:1rem;font-weight:600;cursor:pointer;transition:background .2s}
    .btn:hover:not(:disabled){background:#222}
    .btn:disabled{background:#999;cursor:not-allowed}
    .safe{font-size:.78rem;color:#aaa;margin-top:14px;text-align:center}
    .errmsg{color:#ef4444;font-size:.82rem;margin-top:8px;min-height:1.2em}
    .bad{text-align:center;padding:24px 0}
    .bad h2{font-size:1.1rem;margin-bottom:8px}
    .bad p{color:#666;font-size:.9rem}
  </style>
</head>
<body>
<div class="card">
  <div class="logo">Pairlin</div>
  <div class="tagline">Pay once. No customs surprises. Surplus refunded.</div>
  <div id="root">Loading…</div>
  <div class="safe">🔒 Secured by Mollie · Surplus refunded automatically · GDPR compliant</div>
</div>
<script>
(function(){
  var root = document.getElementById('root');
  var raw = new URLSearchParams(location.search).get('data');
  if (!raw) {
    root.innerHTML = '<div class="bad"><h2>No order found</h2><p>Please return to the retailer and try again.</p></div>';
    return;
  }
  var order;
  try { order = JSON.parse(decodeURIComponent(escape(atob(decodeURIComponent(raw))))); } catch(e) {}
  if (!order || !order.estimates) {
    root.innerHTML = '<div class="bad"><h2>Invalid order data</h2><p>Please return to the retailer and try again.</p></div>';
    return;
  }
  var sc = order.estimates.baseScenario || {};
  function fmt(n){ return '€' + Number(n).toFixed(2); }

  var rows = '';
  rows += '<div class="line"><span>Items</span><span>' + fmt(sc.basketTotal) + '</span></div>';
  if (sc.duty > 0)           rows += '<div class="line"><span>Estimated customs duty</span><span>~' + fmt(sc.duty) + '</span></div>';
  if (sc.vat > 0)            rows += '<div class="line"><span>Estimated VAT 23%</span><span>~' + fmt(sc.vat) + '</span></div>';
  if (sc.courierHandling > 0) rows += '<div class="line"><span>Courier handling (covered)</span><span>~' + fmt(sc.courierHandling) + '</span></div>';
  rows += '<div class="line"><span>Pairlin fee</span><span>' + fmt(sc.serviceFee) + '</span></div>';

  root.innerHTML =
    '<div class="retailer">&#128717; ' + (order.retailerDomain || 'Your order') + '</div>' +
    rows +
    '<div class="divider"></div>' +
    '<div class="total-row"><span>Total due now</span><span class="total-amount">' + fmt(sc.total) + '</span></div>' +
    '<div class="section-label">Your email</div>' +
    '<input type="email" id="email" placeholder="you@email.com" autocomplete="email" />' +
    '<div class="errmsg" id="errmsg"></div>' +
    '<button class="btn" id="paybtn">Pay ' + fmt(sc.total) + ' with Pairlin</button>';

  var emailEl = document.getElementById('email');
  var errmsg  = document.getElementById('errmsg');
  var paybtn  = document.getElementById('paybtn');

  var storedUserId = localStorage.getItem('pairlin_userId');
  var storedEmail  = localStorage.getItem('pairlin_email');
  if (storedEmail) emailEl.value = storedEmail;

  paybtn.addEventListener('click', async function(){
    var email = emailEl.value.trim();
    if (!email || !email.includes('@')) {
      emailEl.classList.add('err');
      errmsg.textContent = 'Please enter a valid email address.';
      return;
    }
    emailEl.classList.remove('err');
    errmsg.textContent = '';
    paybtn.disabled = true;
    paybtn.textContent = 'Creating order…';

    try {
      var userId = storedUserId;
      if (!userId) {
        var uRes = await fetch('/api/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ realEmail: email })
        });
        if (!uRes.ok) throw new Error('Could not create account. Please try again.');
        var uData = await uRes.json();
        userId = uData.userId;
        localStorage.setItem('pairlin_userId', userId);
        localStorage.setItem('pairlin_email', email);
      }

      paybtn.textContent = 'Processing payment…';
      var oRes = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: userId,
          retailerUrl: order.retailerUrl,
          retailerDomain: order.retailerDomain,
          items: order.items,
          iossStatus: order.iossStatus,
          chosenStrategy: order.chosenStrategy || 'keep',
          estimates: order.estimates,
          iossProtection: order.iossProtection || false
        })
      });
      if (!oRes.ok) throw new Error('Could not create order. Please try again.');
      var oData = await oRes.json();

      if (oData.paymentUrl) {
        window.location.href = oData.paymentUrl;
      } else {
        throw new Error('Payment link unavailable. Please try again.');
      }
    } catch(e) {
      errmsg.textContent = e.message || 'Something went wrong. Please try again.';
      paybtn.disabled = false;
      paybtn.textContent = 'Pay ' + fmt(sc.total) + ' with Pairlin';
    }
  });
})();
</script>
</body>
</html>`);
});

app.listen(PORT, async () => {
  console.log(`[server] LandedCost backend running on port ${PORT}`);
  try {
    await initVectorStore();
  } catch (err) {
    console.warn('[server] Vector store init failed — OpenAI classification will use rules only:', err);
  }
});
