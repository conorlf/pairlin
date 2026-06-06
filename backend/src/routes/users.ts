import { Router, Request, Response } from 'express';
import { supabase } from '../db/supabase';
import { generateAlias } from '../lib/alias';

export const usersRouter = Router();

usersRouter.post('/', async (req: Request, res: Response) => {
  const { realEmail, name, deliveryAddress } = req.body as {
    realEmail?: string;
    name?: string;
    deliveryAddress?: Record<string, string>;
  };

  if (!realEmail) {
    res.status(400).json({ error: 'realEmail is required' });
    return;
  }

  const alias = generateAlias(name);

  const { data, error } = await supabase
    .from('users')
    .insert({ real_email: realEmail, platform_email_alias: alias, name, delivery_address: deliveryAddress })
    .select()
    .single();

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.json({ userId: data.id, alias: data.platform_email_alias });
});

usersRouter.patch('/me', async (req: Request, res: Response) => {
  const userId = req.headers['x-user-id'] as string;
  const { excessTolerance, deliveryAddress, name } = req.body as {
    excessTolerance?: number;
    deliveryAddress?: Record<string, string>;
    name?: string;
  };

  if (!userId) {
    res.status(401).json({ error: 'x-user-id header required' });
    return;
  }

  const updates: Record<string, unknown> = {};
  if (excessTolerance !== undefined) updates.excess_tolerance = excessTolerance;
  if (deliveryAddress) updates.delivery_address = deliveryAddress;
  if (name) updates.name = name;

  const { data, error } = await supabase
    .from('users')
    .update(updates)
    .eq('id', userId)
    .select()
    .single();

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.json(data);
});
