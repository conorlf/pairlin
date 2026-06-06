import { Router, Request, Response } from 'express';
import { classifyByRules } from '../lib/tariffLookup';
import { classifyTariff } from '../services/openai';
import { getLiveDutyRate } from '../lib/taricApi';

export const classifyRouter = Router();

interface InboundItem {
  title: string;
  description?: string;
  category?: string;
}

// 4-step classification pipeline:
// Step 1 — Rules-based HS candidate (fast, no API)
// Step 2 — OpenAI GPT-4o with vector store (if rules confidence < 80%)
// Step 3 — TARIC live rate lookup for verified duty rate
// Step 4 — Vector store already attached to OpenAI call (CLASS/BTI precedents)
async function classifyItem(item: InboundItem) {
  // Step 1: Rules-based
  const rulesResult = classifyByRules(item.title, item.description, item.category);
  let hsCode: string;
  let hsDescription: string;
  let aiConfidence: number;

  if (rulesResult && rulesResult.confidence >= 80) {
    hsCode = rulesResult.hsCode;
    hsDescription = rulesResult.hsDescription;
    aiConfidence = rulesResult.confidence;
  } else {
    // Step 2: OpenAI + vector store (CLASS/BTI precedents)
    try {
      const aiResult = await classifyTariff(item);
      hsCode = aiResult.hsCode;
      hsDescription = aiResult.hsDescription;
      aiConfidence = aiResult.confidence;
    } catch (err) {
      console.error('[classify] OpenAI failed for:', item.title, err);
      // Fallback to rules even at low confidence
      hsCode = rulesResult?.hsCode ?? '6217';
      hsDescription = rulesResult?.hsDescription ?? 'Other clothing articles (fallback)';
      aiConfidence = rulesResult?.confidence ?? 25;
    }
  }

  // Step 3: TARIC live rate verification
  const taricResult = await getLiveDutyRate(hsCode);

  // Prefer live rate; fall back to AI-returned rate if live lookup failed
  const dutyRate = taricResult.dutyRate ?? rulesResult?.dutyRate ?? 0.12;

  return {
    title: item.title,
    description: item.description,
    category: item.category,
    hsCode,
    hsDescription,
    dutyRate,
    vatRate: 0.23,
    confidence: aiConfidence,
    rateSource: taricResult.source,
    rateConfidence: taricResult.confidence,
    dutyExpression: taricResult.dutyExpression,
  };
}

classifyRouter.post('/', async (req: Request, res: Response) => {
  const { items, retailerDomain } = req.body as { items?: InboundItem[]; retailerDomain?: string };

  if (!items || !Array.isArray(items) || items.length === 0) {
    res.status(400).json({ error: 'items array is required' });
    return;
  }

  const results = await Promise.all(items.map(classifyItem));

  res.json({ items: results, retailerDomain });
});
