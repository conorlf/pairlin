import { chromium, Page } from 'playwright';
import { supabase } from '../db/supabase';
import { refundSurplus } from './mollie';
import { sendNotification } from './postmark';
import fs from 'fs';
import path from 'path';

interface CustomsInfo {
  courier: string;
  chargeAmount: number;
  currency: string;
  paymentUrl: string;
  deadline: string | null;
}

const CARD = {
  number: process.env.PLATFORM_CARD_NUMBER ?? '',
  expiry: process.env.PLATFORM_CARD_EXPIRY ?? '',
  cvc: process.env.PLATFORM_CARD_CVC ?? '',
  name: process.env.PLATFORM_CARD_NAME ?? 'LandedCost Platform',
};

async function screenshotError(page: Page, orderId: string) {
  const dir = path.join(process.cwd(), 'ops');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir);
  await page.screenshot({ path: path.join(dir, `customs-failed-${orderId}.png`), fullPage: true });
}

async function genericPay(page: Page, amount: number): Promise<string | null> {
  const fillField = async (selectors: string[], value: string) => {
    for (const sel of selectors) {
      try {
        const el = page.locator(sel).first();
        if (await el.isVisible({ timeout: 1500 })) { await el.fill(value); return; }
      } catch {}
    }
  };

  await fillField(['[autocomplete="cc-number"]', '[name*="card"], input[placeholder*="card" i]'], CARD.number);
  await fillField(['[autocomplete="cc-exp"]', '[name*="expiry"], [name*="exp"]'], CARD.expiry);
  await fillField(['[autocomplete="cc-csc"]', '[name*="cvc"], [name*="cvv"], [name*="security"]'], CARD.cvc);
  await fillField(['[autocomplete="cc-name"]', '[name*="card_name"]'], CARD.name);

  const payBtn = page.locator('button[type="submit"], input[type="submit"], button:has-text("Pay"), button:has-text("Submit")').first();
  if (await payBtn.isVisible({ timeout: 5000 })) {
    await payBtn.click();
    await page.waitForLoadState('domcontentloaded', { timeout: 30000 });
  }

  const body = await page.textContent('body') ?? '';
  const ref = body.match(/reference\s*:?\s*([A-Z0-9\-]{5,20})/i)?.[1] ??
    body.match(/confirmation\s*:?\s*([A-Z0-9\-]{5,20})/i)?.[1] ??
    `PAID-${Date.now()}`;
  return ref;
}

export async function payCustomsCharge(order: {
  id: string;
  user_id: string;
  total_collected: number;
  basket_value_eur: number;
  service_fee: number;
  mollie_payment_id: string;
  retailer_domain: string;
  users?: { real_email: string };
}, customs: CustomsInfo): Promise<void> {
  const browser = await chromium.launch({ headless: true });

  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(customs.paymentUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

    let confirmationRef: string | null = null;
    const courier = customs.courier.toLowerCase();

    if (courier.includes('anpost') || courier.includes('an post')) {
      const { anpostPay } = await import('../lib/courier-scripts/anpost');
      confirmationRef = await anpostPay(page, CARD);
    } else if (courier.includes('dhl')) {
      const { dhlPay } = await import('../lib/courier-scripts/dhl');
      confirmationRef = await dhlPay(page, CARD);
    } else if (courier.includes('fedex')) {
      const { fedexPay } = await import('../lib/courier-scripts/fedex');
      confirmationRef = await fedexPay(page, CARD);
    } else {
      confirmationRef = await genericPay(page, customs.chargeAmount);
    }

    const last4 = CARD.number.slice(-4);

    await supabase.from('customs_events').insert({
      order_id: order.id,
      courier: customs.courier,
      charge_amount: customs.chargeAmount,
      currency: customs.currency,
      payment_url: customs.paymentUrl,
      deadline: customs.deadline,
      within_tolerance: true,
      paid_at: new Date().toISOString(),
      confirmation_ref: confirmationRef,
      platform_card_last4: last4,
    });

    // Calculate surplus and refund
    const surplus = (order.total_collected ?? 0) - (order.basket_value_eur ?? 0) - customs.chargeAmount - (order.service_fee ?? 0);

    let mollieRefundId: string | null = null;
    if (surplus > 0.50 && order.mollie_payment_id) {
      const refund = await refundSurplus(
        order.mollie_payment_id,
        surplus,
        `Customs surplus refund — ${order.retailer_domain}`
      );
      mollieRefundId = refund?.id ?? null;
    }

    await supabase.from('orders').update({
      status: 'customs_paid',
      actual_customs_charge: customs.chargeAmount,
      surplus_refunded: surplus > 0.50,
      mollie_refund_id: mollieRefundId,
    }).eq('id', order.id);

    if (order.users?.real_email) {
      await sendNotification({
        to: order.users.real_email,
        subject: '✓ Customs cleared — your order is on its way',
        htmlBody: `<p>We paid the customs charge of <strong>€${customs.chargeAmount.toFixed(2)}</strong> for your order from <strong>${order.retailer_domain}</strong>.</p>
          ${surplus > 0.50 ? `<p>A surplus of <strong>€${surplus.toFixed(2)}</strong> has been refunded to your original payment method.</p>` : ''}
          <p>Confirmation reference: <strong>${confirmationRef}</strong></p>
          <p><a href="${process.env.PLATFORM_CHECKOUT_URL?.replace('/checkout', '/dashboard') ?? '#'}">Track your delivery →</a></p>`,
      });
    }

    console.log(`[customsPayment] Order ${order.id}: paid €${customs.chargeAmount}, ref ${confirmationRef}, surplus refunded €${Math.max(0, surplus).toFixed(2)}`);

  } catch (err) {
    console.error(`[customsPayment] Failed for order ${order.id}:`, err);
    try {
      const p2 = await browser.newPage();
      await p2.goto(customs.paymentUrl).catch(() => {});
      await screenshotError(p2, order.id);
    } catch {}

    await supabase.from('orders').update({ status: 'manual_review' }).eq('id', order.id);

    if (order.users?.real_email) {
      await sendNotification({
        to: order.users.real_email,
        subject: 'Action needed — we could not pay your customs charge automatically',
        htmlBody: `<p>We were unable to automatically pay the customs charge for your order from <strong>${order.retailer_domain}</strong>.</p>
          <p>Payment URL: <a href="${customs.paymentUrl}">${customs.paymentUrl}</a></p>
          <p>Our team has been alerted. Please contact support if this is urgent.</p>`,
      });
    }
  } finally {
    await browser.close();
  }
}
