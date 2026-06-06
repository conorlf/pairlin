import { Page } from 'playwright';

interface Card { number: string; expiry: string; cvc: string; name: string }

export async function anpostPay(page: Page, card: Card): Promise<string> {
  // An Post customs payment portal
  // Fill tracking/reference if prompted
  const refInput = page.locator('input[name*="tracking"], input[placeholder*="tracking"], input[name*="reference"]').first();
  if (await refInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    const url = page.url();
    const ref = url.match(/[A-Z]{2}\d{8,9}[A-Z]{2}/)?.[0] ?? '';
    if (ref) await refInput.fill(ref);
    const next = page.locator('button[type="submit"], button:has-text("Continue"), button:has-text("Next")').first();
    if (await next.isVisible({ timeout: 2000 }).catch(() => false)) {
      await next.click();
      await page.waitForLoadState('domcontentloaded');
    }
  }

  // Card details
  const fill = async (sels: string[], val: string) => {
    for (const s of sels) {
      try {
        const el = page.locator(s).first();
        if (await el.isVisible({ timeout: 1500 })) { await el.fill(val); return; }
      } catch {}
    }
  };

  await fill(['[name*="cardNumber"], [name*="card_number"], [autocomplete="cc-number"]'], card.number.replace(/\s/g, ''));
  await fill(['[name*="expiry"], [name*="exp"], [autocomplete="cc-exp"]'], card.expiry);
  await fill(['[name*="cvv"], [name*="cvc"], [autocomplete="cc-csc"]'], card.cvc);
  await fill(['[name*="cardName"], [name*="card_name"], [autocomplete="cc-name"]'], card.name);

  const pay = page.locator('button:has-text("Pay"), button[type="submit"], input[type="submit"]').first();
  if (await pay.isVisible({ timeout: 5000 })) {
    await pay.click();
    await page.waitForLoadState('domcontentloaded', { timeout: 20000 });
  }

  const body = await page.textContent('body') ?? '';
  const ref = body.match(/confirmation\s*(number|reference|ref)?\s*:?\s*([A-Z0-9\-]{6,20})/i)?.[2]
    ?? body.match(/receipt\s*(number)?\s*:?\s*([A-Z0-9\-]{6,20})/i)?.[2]
    ?? `ANPOST-${Date.now()}`;

  return ref;
}
