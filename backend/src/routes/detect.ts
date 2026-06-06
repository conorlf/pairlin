import { Router, Request, Response } from 'express';
import { scorePageText } from '../lib/iossSignals';
import { detectIOSS } from '../services/openai';
import { supabase } from '../db/supabase';

export const detectRouter = Router();

detectRouter.post('/', async (req: Request, res: Response) => {
  const { pageText, domain } = req.body as { pageText?: string; domain?: string };
  if (!pageText || !domain) {
    res.status(400).json({ error: 'pageText and domain are required' });
    return;
  }

  // Check cache first
  const { data: cached } = await supabase
    .from('retailers')
    .select('ioss_status, ioss_confidence, last_checked')
    .eq('domain', domain)
    .single();

  if (cached?.last_checked) {
    const age = Date.now() - new Date(cached.last_checked).getTime();
    if (age < 24 * 60 * 60 * 1000 && cached.ioss_status !== 'unknown') {
      res.json({ status: cached.ioss_status, confidence: cached.ioss_confidence, signalsFound: [], cached: true });
      return;
    }
  }

  // Rules-based scoring
  const rulesResult = scorePageText(pageText);

  let final = rulesResult;

  // If ambiguous (40-70), confirm with OpenAI
  if (rulesResult.confidence > 35 && rulesResult.confidence < 70) {
    try {
      const aiResult = await detectIOSS(pageText);
      // Blend: weight rules 40%, AI 60%
      const blendedConfidence = Math.round(rulesResult.confidence * 0.4 + aiResult.confidence * 0.6);
      final = {
        status: blendedConfidence >= 65 ? 'ioss' : blendedConfidence <= 35 ? 'not_ioss' : 'unknown',
        confidence: blendedConfidence,
        signalsFound: [...rulesResult.signalsFound, ...aiResult.signalsFound],
      };
    } catch (err) {
      console.error('[detect] OpenAI fallback failed:', err);
    }
  }

  // Cache result
  await supabase.from('retailers').upsert({
    domain,
    ioss_status: final.status,
    ioss_confidence: final.confidence,
    last_checked: new Date().toISOString(),
  });

  res.json({ ...final, cached: false });
});
