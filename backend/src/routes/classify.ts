import { Router, Request, Response } from 'express';
import { classifyByRules } from '../lib/tariffLookup';
import { classifyTariff } from '../services/openai';

export const classifyRouter = Router();

interface InboundItem {
  title: string;
  description?: string;
  category?: string;
}

classifyRouter.post('/', async (req: Request, res: Response) => {
  const { items, retailerDomain } = req.body as { items?: InboundItem[]; retailerDomain?: string };

  if (!items || !Array.isArray(items) || items.length === 0) {
    res.status(400).json({ error: 'items array is required' });
    return;
  }

  const results = await Promise.all(
    items.map(async (item) => {
      // Rules-based first
      const rulesResult = classifyByRules(item.title, item.description, item.category);

      if (rulesResult && rulesResult.confidence >= 80) {
        return { ...item, ...rulesResult };
      }

      // OpenAI fallback
      try {
        const aiResult = await classifyTariff(item);
        return {
          ...item,
          ...aiResult,
          confidence: aiResult.confidence,
        };
      } catch (err) {
        console.error('[classify] OpenAI failed for item:', item.title, err);
        // Return rules result even if low confidence, or a safe default
        return {
          ...item,
          ...(rulesResult ?? {
            hsCode: '6217',
            hsDescription: 'Other clothing articles (fallback)',
            dutyRate: 0.12,
            vatRate: 0.23,
            confidence: 30,
          }),
        };
      }
    })
  );

  res.json({ items: results, retailerDomain });
});
