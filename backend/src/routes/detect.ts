import { Router, Request, Response } from 'express';
import { scorePageText } from '../lib/iossSignals';
import { detectIOSS } from '../services/openai';
import { supabase } from '../db/supabase';

export const detectRouter = Router();

// GET /api/detect?domain=patagonia.com
// Step 1: database lookup only — no page text needed.
// Returns the stored result if the domain has been classified before.
detectRouter.get('/', async (req: Request, res: Response) => {
  const domain = req.query.domain as string;
  if (!domain) { res.status(400).json({ error: 'domain query param required' }); return; }

  const { data } = await supabase
    .from('retailers')
    .select('ioss_status, ioss_confidence, last_checked')
    .eq('domain', domain)
    .single();

  if (!data || data.ioss_status === 'unknown') {
    res.json({ found: false });
    return;
  }

  res.json({
    found: true,
    status: data.ioss_status,
    confidence: data.ioss_confidence,
    last_checked: data.last_checked,
  });
});

// POST /api/detect
// Step 2+3: called only when domain is not in DB.
// Runs signal scoring + OpenAI if ambiguous, stores result, returns confidence score.
detectRouter.post('/', async (req: Request, res: Response) => {
  const { pageText, domain } = req.body as { pageText?: string; domain?: string };
  if (!pageText || !domain) {
    res.status(400).json({ error: 'pageText and domain are required' });
    return;
  }

  const rulesResult = scorePageText(pageText);
  let final = rulesResult;

  if (rulesResult.confidence > 35 && rulesResult.confidence < 70) {
    try {
      const aiResult = await detectIOSS(pageText);
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

  // Store result — all future users on this domain get instant DB response
  await supabase.from('retailers').upsert({
    domain,
    ioss_status: final.status,
    ioss_confidence: final.confidence,
    last_checked: new Date().toISOString(),
  });

  res.json({
    found: true,
    status: final.status,
    confidence: final.confidence,
    signalsFound: final.signalsFound,
  });
});
