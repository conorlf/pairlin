import OpenAI from 'openai';
import 'dotenv/config';

export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  ...(process.env.OPENAI_PROJECT_ID ? { project: process.env.OPENAI_PROJECT_ID } : {}),
});

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

// IOSS detection gets its own completion with web search enabled.
// GPT-4o can search for the retailer's IOSS/VAT status online and combine
// that with the page text — giving a much more confident and accurate result.
async function iossCompletion(prompt: string, systemPrompt: string): Promise<unknown> {
  const vectorId = process.env.OPENAI_VECTOR_STORE_ID;
  const tools: object[] = [{ type: 'web_search_preview' }];
  if (vectorId) tools.push({ type: 'file_search', vector_store_ids: [vectorId] });

  const response = await openai.responses.create({
    model: 'gpt-4o',
    tools: tools as Parameters<typeof openai.responses.create>[0]['tools'],
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

export async function detectIOSS(domain: string, pageText = ''): Promise<{
  status: 'ioss' | 'not_ioss' | 'unknown';
  confidence: number;
  signalsFound: string[];
}> {
  const truncated = pageText.slice(0, 6000);
  const pageSection = truncated
    ? `Page text from their website:\n${truncated}\n\n`
    : '';
  return iossCompletion(
    `Retailer domain: ${domain}\n\n${pageSection}Use web search to find information about this retailer's IOSS registration, EU VAT status, and customs policy for EU shoppers.`,
    `You are an EU customs and VAT compliance expert. Determine whether a retailer is registered under the EU IOSS (Import One-Stop Shop) scheme.

IOSS-registered retailers collect EU VAT at checkout — customers pay no additional charges on delivery for orders under €150.
Non-IOSS retailers do not collect EU VAT — customers pay customs duty and VAT when the parcel arrives at the border.

Use the web search tool to look up this retailer's IOSS/VAT status from sources like their shipping policy pages, EU customs databases, consumer forums, and news articles. Combine web findings with the page text provided.

From July 2026, IOSS retailers also charge €3 per tariff heading at checkout — this is a definitive IOSS signal.

Return JSON only — no other text:
{
  "status": "ioss" | "not_ioss" | "unknown",
  "confidence": 0-100,
  "signalsFound": ["plain English description of each signal found, noting whether it came from the page text or web search"]
}`
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
