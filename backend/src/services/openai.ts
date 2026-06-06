import OpenAI from 'openai';
import 'dotenv/config';

export const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function vectorStoreTools() {
  const id = process.env.OPENAI_VECTOR_STORE_ID;
  if (!id) return {};
  return {
    tools: [{ type: 'file_search' as const, vector_store_ids: [id] }],
  };
}

async function jsonCompletion(prompt: string, systemPrompt: string): Promise<unknown> {
  const response = await openai.responses.create({
    model: 'gpt-4o',
    ...vectorStoreTools(),
    input: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt },
    ],
  });
  const text = response.output_text;
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON in OpenAI response');
  return JSON.parse(match[0]);
}

export async function detectIOSS(pageText: string): Promise<{
  status: 'ioss' | 'not_ioss' | 'unknown';
  confidence: number;
  signalsFound: string[];
}> {
  const truncated = pageText.slice(0, 6000);
  return jsonCompletion(
    `Analyse this checkout page text for IOSS registration signals:\n\n${truncated}`,
    `You are an EU customs expert. Analyse the provided checkout page text and determine if the retailer is IOSS registered.
Return JSON only:
{
  "status": "ioss" | "not_ioss" | "unknown",
  "confidence": 0-100,
  "signalsFound": ["list of specific signals you detected"]
}
IOSS indicators: VAT displayed at checkout, "all taxes included", "duties and taxes paid", EU VAT number visible, EUR pricing with VAT line item.
Non-IOSS indicators: "customs charges may apply", "duties are buyer's responsibility", GBP pricing without VAT, vague customs policy.
From July 2026, IOSS retailers charge €3 per tariff heading at checkout — this is a new IOSS indicator.`
  ) as Promise<{ status: 'ioss' | 'not_ioss' | 'unknown'; confidence: number; signalsFound: string[] }>;
}

export async function classifyTariff(item: {
  title: string;
  description?: string;
  category?: string;
}): Promise<{
  hsCode: string;
  hsDescription: string;
  dutyRate: number;
  vatRate: number;
  confidence: number;
}> {
  return jsonCompletion(
    `Classify this product for EU customs:\nTitle: ${item.title}\nDescription: ${item.description ?? ''}\nCategory: ${item.category ?? ''}`,
    `You are an EU customs tariff expert. Classify the product using the EU Combined Nomenclature.
Return JSON only:
{
  "hsCode": "4-digit HS code as string e.g. '6109'",
  "hsDescription": "short description e.g. 'T-shirts, knitted'",
  "dutyRate": 0.12,
  "vatRate": 0.23,
  "confidence": 85
}
Key rates: clothing (61xx/62xx) 12%, footwear (64xx) 17%, electronics (85xx) 0%, cosmetics (33xx) 6.5%, bags (4202) 3.7%, books (49xx) 0%. VAT rate for Ireland is 23%.`
  ) as Promise<{ hsCode: string; hsDescription: string; dutyRate: number; vatRate: number; confidence: number }>;
}

export async function classifyEmail(content: {
  from: string;
  subject: string;
  body: string;
}): Promise<{
  type: 'order_confirmation' | 'shipping' | 'customs' | 'other';
  courier?: string;
  chargeAmount?: number;
  currency?: string;
  paymentUrl?: string;
  deadline?: string;
  trackingNumber?: string;
  orderRef?: string;
}> {
  return jsonCompletion(
    `From: ${content.from}\nSubject: ${content.subject}\n\n${content.body.slice(0, 3000)}`,
    `You are an email classifier for a customs payment platform. Classify this email.
Return JSON only:
{
  "type": "order_confirmation" | "shipping" | "customs" | "other",
  "courier": "An Post" | "DHL" | "FedEx" | null,
  "chargeAmount": number or null,
  "currency": "EUR" or null,
  "paymentUrl": "URL string" or null,
  "deadline": "ISO date string" or null,
  "trackingNumber": "tracking number string" or null,
  "orderRef": "order reference string" or null
}
Customs emails: mention duty, import charges, customs hold, payment required for release.
Shipping emails: mention dispatch, tracking, on its way.
Order confirmation: order placed, order number, receipt.`
  ) as Promise<{
    type: 'order_confirmation' | 'shipping' | 'customs' | 'other';
    courier?: string;
    chargeAmount?: number;
    currency?: string;
    paymentUrl?: string;
    deadline?: string;
    trackingNumber?: string;
    orderRef?: string;
  }>;
}
