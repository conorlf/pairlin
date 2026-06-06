import { Router, Request, Response } from 'express';
import { detectIOSS } from '../services/openai';
import { supabase } from '../db/supabase';

export const detectRouter = Router();

// GET /api/detect?domain=fashionnova.com
// Database lookup only — returns instantly if the domain has been seen before.
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
// Called only when the domain is not in the database.
// Sends page text directly to GPT-4o — no keyword pre-filtering.
// GPT-4o reads the page in context and returns a confidence score.
// Result is stored in the retailers table for all future users.
detectRouter.post('/', async (req: Request, res: Response) => {
  const { pageText, domain } = req.body as { pageText?: string; domain?: string };
  if (!domain) {
    res.status(400).json({ error: 'domain is required' });
    return;
  }

  try {
    const result = await detectIOSS(domain, pageText ?? '');

    await supabase.from('retailers').upsert({
      domain,
      ioss_status: result.status,
      ioss_confidence: result.confidence,
      last_checked: new Date().toISOString(),
    });

    res.json({ found: true, status: result.status, confidence: result.confidence, signalsFound: result.signalsFound });
  } catch (err) {
    console.error('[detect] OpenAI detection failed:', err);
    res.status(500).json({ error: 'Detection failed' });
  }
});
