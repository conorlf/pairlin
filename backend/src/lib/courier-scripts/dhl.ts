import { Page } from 'playwright';

interface Card { number: string; expiry: string; cvc: string; name: string }

export async function dhlPay(page: Page, card: Card): Promise<string> {
  const fill = async (sels: string[], val: string) => {
    for (const s of sels) {
      try {
        const el = page.locator(s).first();
        if (await el.isVisible({ timeout: 1500 })) { await el.fill(val); return; }
      } catch {}
    }
  };

  await fill(['[autocomplete="cc-number"], [name*="cardNumber"], [name*="card-number"]'], card.number.replace(/\s/g, ''));
  await fill(['[autocomplete="cc-exp"], [name*="expiryDate"], [name*="expiry"]'], card.expiry);
  await fill(['[autocomplete="cc-csc"], [name*="securityCode"], [name*="cvv"]'], card.cvc);
  await fill(['[autocomplete="cc-name"], [name*="nameOnCard"]'], card.name);

  const pay = page.locator('button:has-text("Pay now"), button:has-text("Pay"), button[type="submit"]').first();
  if (await pay.isVisible({ timeout: 5000 })) {
    await pay.click();
    await page.waitForLoadState('domcontentloaded', { timeout: 20000 });
  }

  const body = await page.textContent('body') ?? '';
  return body.match(/confirmation\s*:?\s*([A-Z0-9\-]{6,20})/i)?.[1] ?? `DHL-${Date.now()}`;
}
