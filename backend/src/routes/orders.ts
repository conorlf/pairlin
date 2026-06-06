import { Router, Request, Response } from 'express';
import { supabase } from '../db/supabase';
import { createPayment } from '../services/mollie';

export const ordersRouter = Router();

ordersRouter.get('/', async (req: Request, res: Response) => {
  const userId = req.headers['x-user-id'] as string | undefined;

  let query = supabase
    .from('orders')
    .select('*')
    .order('created_at', { ascending: false });

  if (userId) query = query.eq('user_id', userId);

  const { data, error } = await query;
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
});

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
      description: `LandedCost split order — ${retailerDomain}`,
      redirectUrl: `${checkoutUrl}/confirmation?splitGroup=${splitGroupId}`,
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

  if (error) { res.status(500).json({ error: error.message }); return; }

  const payment = await createPayment({
    orderId: data.id,
    amountEur: sc.total,
    description: `LandedCost — ${retailerDomain}`,
    redirectUrl: `${checkoutUrl}/confirmation?orderId=${data.id}`,
    webhookUrl: `${backendUrl}/webhooks/mollie`,
    metadata: { orderId: data.id },
  });

  await supabase.from('orders').update({ mollie_payment_id: payment.id }).eq('id', data.id);
  res.json({ orderId: data.id, paymentUrl: payment.getCheckoutUrl() });
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
