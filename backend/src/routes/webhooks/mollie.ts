import { Router, Request, Response } from 'express';
import { getPayment } from '../../services/mollie';
import { supabase } from '../../db/supabase';
import { completeRetailerCheckout } from '../../services/playwright';

export const mollieWebhookRouter = Router();

mollieWebhookRouter.post('/', async (req: Request, res: Response) => {
  const { id: paymentId } = req.body as { id?: string };

  if (!paymentId) {
    res.status(400).send('Missing payment id');
    return;
  }

  res.sendStatus(200); // Acknowledge immediately to Mollie

  try {
    const payment = await getPayment(paymentId);
    if (payment.status !== 'paid') return;

    const meta = payment.metadata as Record<string, string> | null;
    if (!meta) return;

    if (meta.splitGroupId && meta.orderIds) {
      const orderIds = meta.orderIds.split(',');

      await supabase
        .from('orders')
        .update({ status: 'checkout_in_progress' })
        .in('id', orderIds);

      for (const orderId of orderIds) {
        const { data: order } = await supabase
          .from('orders')
          .select('*, users(*)')
          .eq('id', orderId)
          .single();
        if (order) {
          await completeRetailerCheckout(order, order.items_json);
        }
      }
    } else if (meta.orderId) {
      await supabase
        .from('orders')
        .update({ status: 'checkout_in_progress' })
        .eq('id', meta.orderId);

      const { data: order } = await supabase
        .from('orders')
        .select('*, users(*)')
        .eq('id', meta.orderId)
        .single();

      if (order) {
        await completeRetailerCheckout(order, null);
      }
    }
  } catch (err) {
    console.error('[mollie webhook] Error:', err);
  }
});
