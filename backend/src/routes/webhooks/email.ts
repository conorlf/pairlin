import { Router, Request, Response } from 'express';
import { supabase } from '../../db/supabase';
import { classifyEmail } from '../../services/openai';
import { forwardEmail, sendNotification } from '../../services/postmark';
import { payCustomsCharge } from '../../services/customsPayment';

export const emailWebhookRouter = Router();

// Rules-based pre-filter to avoid OpenAI costs on obvious emails
function quickClassify(from: string, subject: string): 'customs' | 'shipping' | 'order_confirmation' | null {
  const f = from.toLowerCase();
  const s = subject.toLowerCase();

  if (/anpost|an post|dhl|fedex|customs|import|duty|hold|clearance/.test(f)) {
    if (/customs|duty|charge|hold|clearance|payment required/.test(s)) return 'customs';
    if (/tracking|dispatch|shipped|on its way|out for delivery/.test(s)) return 'shipping';
  }
  if (/order confirm|thank you for your order|your order/.test(s)) return 'order_confirmation';
  if (/shipped|dispatched|tracking|on its way/.test(s)) return 'shipping';

  return null;
}

emailWebhookRouter.post('/', async (req: Request, res: Response) => {
  res.sendStatus(200); // Acknowledge Postmark immediately

  const { To, From, Subject, TextBody, HtmlBody } = req.body as {
    To: string;
    From: string;
    Subject: string;
    TextBody: string;
    HtmlBody: string;
  };

  try {
    // Look up user by alias
    const { data: user } = await supabase
      .from('users')
      .select('*')
      .eq('platform_email_alias', To.toLowerCase())
      .single();

    if (!user) {
      console.warn('[email webhook] No user found for alias:', To);
      return;
    }

    // Classify email
    let type: string;
    const quick = quickClassify(From, Subject);
    let classification: Awaited<ReturnType<typeof classifyEmail>> | null = null;

    if (quick) {
      type = quick;
    } else {
      classification = await classifyEmail({ from: From, subject: Subject, body: TextBody ?? '' });
      type = classification.type;
    }

    // Store email
    const { data: emailRecord } = await supabase.from('emails').insert({
      user_id: user.id,
      from_address: From,
      subject: Subject,
      type,
      raw_content: TextBody ?? HtmlBody,
    }).select().single();

    // Forward to real inbox
    await forwardEmail({
      to: user.real_email,
      subject: Subject,
      originalFrom: From,
      htmlBody: HtmlBody,
      textBody: TextBody,
    });

    await supabase.from('emails').update({ forwarded_at: new Date().toISOString() }).eq('id', emailRecord?.id);

    // Act on type
    if (type === 'customs') {
      if (!classification) {
        classification = await classifyEmail({ from: From, subject: Subject, body: TextBody ?? '' });
      }

      // Match to an order
      const { data: orders } = await supabase
        .from('orders')
        .select('*, users(*)')
        .eq('user_id', user.id)
        .in('status', ['in_transit', 'customs_hold'])
        .order('created_at', { ascending: false });

      let order = orders?.[0] ?? null;

      if (classification.trackingNumber && orders) {
        const match = orders.find(o => o.tracking_number === classification!.trackingNumber);
        if (match) order = match;
      }

      if (!order) {
        console.warn('[email webhook] Could not match customs email to order for user:', user.id);
        return;
      }

      await supabase.from('orders').update({ status: 'customs_hold' }).eq('id', order.id);
      await supabase.from('emails').update({ order_id: order.id }).eq('id', emailRecord?.id);

      // Check tolerance
      const chargeAmount = classification.chargeAmount ?? 0;
      const estimated = (order.estimated_duty ?? 0) + (order.estimated_vat ?? 0) + (order.estimated_courier_handling ?? 0);
      const overEstimate = chargeAmount - estimated;
      const tolerance = user.excess_tolerance ?? 10;

      if (overEstimate <= tolerance && classification.paymentUrl) {
        await payCustomsCharge(order, {
          courier: classification.courier ?? 'An Post',
          chargeAmount,
          currency: classification.currency ?? 'EUR',
          paymentUrl: classification.paymentUrl,
          deadline: classification.deadline ?? null,
        });
      } else {
        await sendNotification({
          to: user.real_email,
          subject: `Action needed — customs charge €${chargeAmount.toFixed(2)} exceeds estimate`,
          htmlBody: `<p>A customs charge of <strong>€${chargeAmount.toFixed(2)}</strong> has been received for your order from ${order.retailer_domain}.</p>
            <p>This exceeds your estimate by <strong>€${overEstimate.toFixed(2)}</strong>, which is above your tolerance of €${tolerance.toFixed(2)}.</p>
            <p><a href="${process.env.PLATFORM_CHECKOUT_URL?.replace('/checkout', '/dashboard') ?? '#'}">Approve payment in dashboard →</a></p>`,
        });
      }

    } else if (type === 'shipping') {
      if (!classification) {
        classification = await classifyEmail({ from: From, subject: Subject, body: TextBody ?? '' });
      }
      if (classification.trackingNumber) {
        await supabase
          .from('orders')
          .update({ tracking_number: classification.trackingNumber, status: 'in_transit' })
          .eq('user_id', user.id)
          .in('status', ['awaiting_payment', 'checkout_in_progress', 'in_transit']);
      }
    } else if (type === 'order_confirmation') {
      if (!classification) {
        classification = await classifyEmail({ from: From, subject: Subject, body: TextBody ?? '' });
      }
      if (classification.orderRef) {
        await supabase
          .from('orders')
          .update({ retailer_order_ref: classification.orderRef })
          .eq('user_id', user.id)
          .eq('status', 'checkout_in_progress');
      }
    }

  } catch (err) {
    console.error('[email webhook] Error:', err);
  }
});
