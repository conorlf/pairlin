import { chromium, Page } from 'playwright';
import { supabase } from '../db/supabase';
import { sendNotification } from './postmark';
import fs from 'fs';
import path from 'path';

interface OrderRecord {
  id: string;
  retailer_url: string;
  retailer_domain: string;
  split_index?: number;
  users: {
    name?: string;
    real_email: string;
    platform_email_alias: string;
    delivery_address?: {
      line1: string;
      line2?: string;
      city: string;
      county?: string;
      postcode: string;
      country: string;
    };
  };
}

interface ItemSubset {
  title: string;
  hsCode: string;
}

const CARD = {
  number: process.env.PLATFORM_CARD_NUMBER ?? '',
  expiry: process.env.PLATFORM_CARD_EXPIRY ?? '',
  cvc: process.env.PLATFORM_CARD_CVC ?? '',
  name: process.env.PLATFORM_CARD_NAME ?? 'LandedCost Platform',
};

async function fillField(page: Page, selectors: string[], value: string): Promise<boolean> {
  for (const sel of selectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 1500 })) {
        await el.fill(value);
        return true;
      }
    } catch {}
  }
  return false;
}

async function screenshotError(page: Page, orderId: string) {
  const dir = path.join(process.cwd(), 'ops');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir);
  await page.screenshot({ path: path.join(dir, `failed-${orderId}.png`), fullPage: true });
}

export async function completeRetailerCheckout(
  order: OrderRecord,
  itemSubset: ItemSubset[] | null
): Promise<void> {
  const user = order.users;
  const addr = user.delivery_address;
  const browser = await chromium.launch({ headless: true });

  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(order.retailer_url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // If split order: remove items not in itemSubset from cart
    if (itemSubset && itemSubset.length > 0) {
      const allowedTitles = new Set(itemSubset.map(i => i.title.toLowerCase()));
      const removeButtons = await page.locator('[class*="remove"], button[aria-label*="remove"], [data-action="remove"]').all();
      for (const btn of removeButtons) {
        try {
          const row = await btn.locator('..').textContent();
          if (row && !allowedTitles.has(row.toLowerCase().trim())) {
            await btn.click();
            await page.waitForTimeout(500);
          }
        } catch {}
      }
    }

    // Navigate to checkout if not already there
    if (!page.url().match(/checkout|payment|pay/i)) {
      const checkoutBtn = page.locator('a[href*="checkout"], button:has-text("Checkout"), [data-action="checkout"]').first();
      if (await checkoutBtn.isVisible({ timeout: 3000 })) {
        await checkoutBtn.click();
        await page.waitForLoadState('domcontentloaded');
      }
    }

    await page.waitForTimeout(2000);

    // Fill name
    if (user.name) {
      const [firstName, ...rest] = user.name.split(' ');
      await fillField(page, ['[autocomplete="given-name"]', '[name*="first_name"]', '[name*="firstName"]'], firstName);
      if (rest.length) {
        await fillField(page, ['[autocomplete="family-name"]', '[name*="last_name"]', '[name*="lastName"]'], rest.join(' '));
      }
      await fillField(page, ['[autocomplete="name"]', '[name="name"]'], user.name);
    }

    // Fill address
    if (addr) {
      await fillField(page, ['[autocomplete="address-line1"]', '[name*="address1"]', '[name*="address_1"]'], addr.line1);
      if (addr.line2) {
        await fillField(page, ['[autocomplete="address-line2"]', '[name*="address2"]'], addr.line2);
      }
      await fillField(page, ['[autocomplete="address-level2"]', '[name*="city"]'], addr.city);
      if (addr.postcode) {
        await fillField(page, ['[autocomplete="postal-code"]', '[name*="zip"]', '[name*="postcode"]'], addr.postcode);
      }
      if (addr.country) {
        await fillField(page, ['[autocomplete="country"]', '[name*="country"]'], addr.country);
      }
    }

    // Fill email with platform alias
    await fillField(page, ['[autocomplete="email"]', 'input[type="email"]', '[name="email"]'], user.platform_email_alias);

    // Fill payment card
    await fillField(page, [
      '[autocomplete="cc-number"]', '[name*="card_number"]', '[name*="cardNumber"]',
      'input[placeholder*="card number"], input[placeholder*="Card number"]',
    ], CARD.number);

    await fillField(page, [
      '[autocomplete="cc-exp"]', '[name*="expiry"]', '[name*="exp_date"]',
    ], CARD.expiry);

    await fillField(page, [
      '[autocomplete="cc-csc"]', '[name*="cvc"]', '[name*="cvv"]', '[name*="security_code"]',
    ], CARD.cvc);

    await fillField(page, [
      '[autocomplete="cc-name"]', '[name*="card_name"]', '[name*="cardName"]',
    ], CARD.name);

    // Submit order
    const submitBtn = page.locator('button[type="submit"], input[type="submit"], button:has-text("Place order"), button:has-text("Pay now"), button:has-text("Complete order")').first();
    if (await submitBtn.isVisible({ timeout: 5000 })) {
      await submitBtn.click();
      await page.waitForLoadState('domcontentloaded', { timeout: 30000 });
    }

    // Extract order reference from confirmation page
    const bodyText = await page.textContent('body') ?? '';
    const orderRefMatch = bodyText.match(/order\s*(#|number|ref|reference)?\s*:?\s*([A-Z0-9\-]{5,20})/i);
    const orderRef = orderRefMatch?.[2] ?? null;

    await supabase.from('orders').update({
      retailer_order_ref: orderRef,
      status: 'in_transit',
    }).eq('id', order.id);

    console.log(`[playwright] Order ${order.id} completed. Retailer ref: ${orderRef}`);

  } catch (err) {
    console.error(`[playwright] Failed for order ${order.id}:`, err);
    try {
      const page2 = await browser.newPage();
      await page2.goto(order.retailer_url).catch(() => {});
      await screenshotError(page2, order.id);
    } catch {}

    await supabase.from('orders').update({ status: 'manual_review' }).eq('id', order.id);

    if (user.real_email) {
      await sendNotification({
        to: user.real_email,
        subject: 'Action needed — we could not complete your order automatically',
        htmlBody: `<p>We were unable to automatically complete your order from <strong>${order.retailer_domain}</strong>.</p>
          <p>Our team has been alerted and will handle this manually. You will not be charged any extra.</p>
          <p><a href="${process.env.PLATFORM_CHECKOUT_URL?.replace('/checkout', '/dashboard') ?? '#'}">View in dashboard →</a></p>`,
      });
    }
  } finally {
    await browser.close();
  }
}
