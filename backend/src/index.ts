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

// Checkout page (served for MVP demo)
app.get('/checkout', (_req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>LandedCost — Secure Checkout</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 480px; margin: 60px auto; padding: 0 16px; color: #111; }
    h1 { font-size: 1.4rem; margin-bottom: 4px; }
    .sub { color: #666; font-size: 0.9rem; margin-bottom: 24px; }
    .line { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #eee; }
    .total { font-weight: bold; font-size: 1.1rem; }
    .btn { display: block; width: 100%; margin-top: 24px; padding: 14px; background: #111; color: #fff;
           border: none; border-radius: 8px; font-size: 1rem; cursor: pointer; text-align: center; }
    .safe { font-size: 0.8rem; color: #888; margin-top: 12px; text-align: center; }
  </style>
</head>
<body>
  <h1>LandedCost Checkout</h1>
  <p class="sub">Pay once. No customs surprises. Surplus refunded.</p>
  <div id="breakdown">Loading order…</div>
  <div class="safe">🔒 Secured by Mollie · Surplus refunded automatically · GDPR compliant</div>
  <script>
    const params = new URLSearchParams(location.search);
    const orderId = params.get('orderId') ?? params.get('splitGroup');
    const div = document.getElementById('breakdown');
    if (!orderId) {
      div.textContent = 'No order found. Please return to the retailer and try again.';
    } else {
      fetch('/api/orders/' + orderId)
        .then(r => r.json())
        .then(order => {
          div.innerHTML = \`
            <div class="line"><span>Items</span><span>€\${Number(order.basket_value_eur).toFixed(2)}</span></div>
            <div class="line"><span>Estimated customs duty</span><span>€\${Number(order.estimated_duty).toFixed(2)}</span></div>
            <div class="line"><span>Estimated VAT</span><span>€\${Number(order.estimated_vat).toFixed(2)}</span></div>
            <div class="line"><span>Courier handling</span><span>€\${Number(order.estimated_courier_handling).toFixed(2)}</span></div>
            <div class="line"><span>LandedCost fee</span><span>€\${Number(order.service_fee).toFixed(2)}</span></div>
            <div class="line total"><span>Total</span><span>€\${Number(order.total_collected).toFixed(2)}</span></div>
            <a class="btn" href="#">Pay €\${Number(order.total_collected).toFixed(2)} with Mollie</a>
          \`;
        })
        .catch(() => { div.textContent = 'Could not load order details.'; });
    }
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
