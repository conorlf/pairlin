import { Page } from 'playwright';

interface Card { number: string; expiry: string; cvc: string; name: string }

export async function fedexPay(page: Page, card: Card): Promise<string> {
  const fill = async (sels: string[], val: string) => {
    for (const s of sels) {
      try {
        const el = page.locator(s).first();
        if (await el.isVisible({ timeout: 1500 })) { await el.fill(val); return; }
      } catch {}
    }
  };

  await fill(['[autocomplete="cc-number"], [id*="cardNumber"], [name*="creditCard"]'], card.number.replace(/\s/g, ''));
  await fill(['[autocomplete="cc-exp"], [id*="expiry"], [name*="expiryDate"]'], card.expiry);
  await fill(['[autocomplete="cc-csc"], [id*="cvv"], [name*="securityCode"]'], card.cvc);
  await fill(['[autocomplete="cc-name"], [id*="cardHolder"]'], card.name);

  const pay = page.locator('button:has-text("Pay"), button[type="submit"]').first();
  if (await pay.isVisible({ timeout: 5000 })) {
    await pay.click();
    await page.waitForLoadState('domcontentloaded', { timeout: 20000 });
  }

  const body = await page.textContent('body') ?? '';
  return body.match(/confirmation\s*:?\s*([A-Z0-9\-]{6,20})/i)?.[1] ?? `FEDEX-${Date.now()}`;
}
