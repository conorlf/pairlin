import { Router, Request, Response } from 'express';
import { supabase } from '../db/supabase';
import { createPayment } from '../services/mollie';

export const ordersRouter = Router();

ordersRouter.post('/', async (req: Request, res: Response) => {
  const {
    userId, retailerUrl, retailerDomain, items, iossStatus,
    chosenStrategy, estimates, iossProtection,
  } = req.body as {
    userId: string;
    retailerUrl: string;
    retailerDomain: string;
    items: unknown[];
    iossStatus: string;
    chosenStrategy: string;
    estimates: {
      baseScenario: { basketTotal: number; duty: number; vat: number; courierHandling: number; serviceFee: number; total: number };
      splits?: unknown[][];
    };
    iossProtection?: boolean;
  };

  if (!userId || !retailerUrl || !items) {
    res.status(400).json({ error: 'userId, retailerUrl, items are required' });
    return;
  }

  const sc = estimates.baseScenario;
  const backendUrl = process.env.BACKEND_URL!;
  const checkoutUrl = process.env.PLATFORM_CHECKOUT_URL!;

  if (chosenStrategy === 'split' && estimates.splits) {
    // Create two linked orders
    const splitGroupId = crypto.randomUUID();
    const orderIds: string[] = [];

    for (let i = 0; i < 2; i++) {
      const splitItems = estimates.splits[i] as { price_eur: number; qty: number; dutyRate: number; vatRate: number }[];
      const splitBasket = splitItems.reduce((s: number, it) => s + it.price_eur * it.qty, 0);

      const { data, error } = await supabase.from('orders').insert({
        user_id: userId,
        retailer_url: retailerUrl,
        retailer_domain: retailerDomain,
        split_group_id: splitGroupId,
        split_index: i + 1,
        items_json: splitItems,
        basket_value_eur: splitBasket,
        estimated_duty: sc.duty / 2,
        estimated_vat: sc.vat / 2,
        estimated_courier_handling: sc.courierHandling,
        service_fee: 2.95,
        total_collected: sc.total / 2,
        ioss_protection: false,
      }).select().single();

      if (error) { res.status(500).json({ error: error.message }); return; }
      orderIds.push(data.id);
    }

    const payment = await createPayment({
      orderId: splitGroupId,
      amountEur: sc.total,
      description: `Pairlin split order — ${retailerDomain}`,
      redirectUrl: `${checkoutUrl}/orders`,
      webhookUrl: `${backendUrl}/webhooks/mollie`,
      metadata: { orderIds: orderIds.join(','), splitGroupId },
    });

    await supabase.from('orders').update({ mollie_payment_id: payment.id }).in('id', orderIds);
    res.json({ splitGroupId, orderIds, paymentUrl: payment.getCheckoutUrl() });
    return;
  }

  // Single order
  const serviceFee = iossProtection ? 1.99 : (sc.basketTotal >= 150 ? 3.05 : 2.95);
  const { data, error } = await supabase.from('orders').insert({
    user_id: userId,
    retailer_url: retailerUrl,
    retailer_domain: retailerDomain,
    items_json: items,
    basket_value_eur: sc.basketTotal,
    estimated_duty: sc.duty,
    estimated_vat: sc.vat,
    estimated_courier_handling: sc.courierHandling,
    service_fee: serviceFee,
    total_collected: sc.total,
    ioss_protection: iossProtection ?? false,
  }).select().single();

  if (error) {
    console.error('[orders] Supabase insert error:', error.message);
    res.status(500).json({ error: error.message });
    return;
  }

  try {
    const payment = await createPayment({
      orderId: data.id,
      amountEur: sc.total,
      description: `Pairlin — ${retailerDomain}`,
      redirectUrl: `${checkoutUrl}/orders/${data.id}`,
      webhookUrl: `${backendUrl}/webhooks/mollie`,
      metadata: { orderId: data.id },
    });

    await supabase.from('orders').update({ mollie_payment_id: payment.id }).eq('id', data.id);
    res.json({ orderId: data.id, paymentUrl: payment.getCheckoutUrl() });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[orders] Mollie payment error:', msg);
    res.status(500).json({ error: msg });
  }
});

ordersRouter.get('/', async (req: Request, res: Response) => {
  const { data, error } = await supabase
    .from('orders')
    .select('id, retailer_domain, basket_value_eur, status, created_at, ioss_status, ioss_protection, split_group_id, split_index, tracking_number')
    .order('created_at', { ascending: false });

  if (error) { res.status(500).json({ error: error.message }); return; }

  const norm = (d: string) => d.replace(/^www\./, '');

  const domains = [...new Set((data ?? []).map(o => o.retailer_domain).filter(Boolean))];
  const lookupDomains = [...new Set(domains.flatMap(d => [d, norm(d)]))];
  const { data: retailers } = lookupDomains.length
    ? await supabase.from('retailers').select('domain, ioss_status').in('domain', lookupDomains)
    : { data: [] };

  const retailerMap: Record<string, string> = {};
  for (const r of (retailers ?? []) as { domain: string; ioss_status: string }[]) {
    retailerMap[r.domain] = r.ioss_status;
    retailerMap[norm(r.domain)] = r.ioss_status;
  }

  res.json((data ?? []).map(o => ({
    ...o,
    ioss_status: o.ioss_status ?? retailerMap[o.retailer_domain] ?? retailerMap[norm(o.retailer_domain)] ?? null,
  })));
});

ordersRouter.get('/:id', async (req: Request, res: Response) => {
  const { data, error } = await supabase
    .from('orders')
    .select('*, customs_events(*), emails(id, type, received_at, forwarded_at, subject, from_address)')
    .eq('id', req.params.id)
    .single();

  if (error) { res.status(404).json({ error: 'Order not found' }); return; }
  res.json(data);
});
