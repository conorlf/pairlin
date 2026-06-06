import { Router, Request, Response } from 'express';
import { toEur, getCourierHandling } from '../lib/customsEstimate';
import { optimise, ClassifiedItem } from '../lib/basketOptimizer';

export const estimateRouter = Router();

interface InboundItem {
  title: string;
  hsCode: string;
  hsDescription: string;
  price: number;
  currency: string;
  qty: number;
  dutyRate: number;
  vatRate: number;
  confidence: number;
}

estimateRouter.post('/', async (req: Request, res: Response) => {
  const { items, retailerDomain, iossStatus, courier, userCountry } = req.body as {
    items?: InboundItem[];
    retailerDomain?: string;
    iossStatus?: string;
    courier?: string;
    userCountry?: string;
  };

  if (!items || !Array.isArray(items) || items.length === 0) {
    res.status(400).json({ error: 'items array is required' });
    return;
  }

  // Convert all prices to EUR
  const classifiedItems: ClassifiedItem[] = await Promise.all(
    items.map(async (item) => ({
      title: item.title,
      hsCode: item.hsCode,
      hsDescription: item.hsDescription,
      price_eur: await toEur(item.price, item.currency),
      qty: item.qty || 1,
      dutyRate: item.dutyRate,
      vatRate: item.vatRate ?? 0.23,
      confidence: item.confidence,
    }))
  );

  const basketTotal = classifiedItems.reduce((s, i) => s + i.price_eur * i.qty, 0);
  const isOver150 = basketTotal >= 150;
  const isIoss = (iossStatus ?? 'unknown') === 'ioss';
  const chapters = new Set(classifiedItems.map(i => i.hsCode.slice(0, 2))).size;

  const handlingResult = await getCourierHandling(courier ?? null, basketTotal, chapters, isIoss, isOver150);

  const optimisation = optimise(classifiedItems, iossStatus ?? 'unknown', handlingResult.amount);

  // Probability of customs hold (heuristic)
  let holdProbability = 0;
  if (!isIoss) holdProbability = 82;
  else if (isOver150) holdProbability = 90;
  else holdProbability = 15; // IOSS spot check risk

  const estimatedDelay = holdProbability > 50 ? '10-14 days' : null;

  res.json({
    basketTotal: Math.round(basketTotal * 100) / 100,
    isOver150,
    iossStatus: iossStatus ?? 'unknown',
    distinctHsChapters: chapters,
    courierHandling: handlingResult,
    holdProbability,
    estimatedDelay,
    optimisation,
    itemsClassified: classifiedItems,
  });
});
