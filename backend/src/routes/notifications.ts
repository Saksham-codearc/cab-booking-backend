import { Router } from 'express';
import { requireAuth } from '@clerk/express';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';
import { asyncHandler } from '../lib/http.js';
import { requireProfile, AuthedRequest } from '../middleware/auth.js';
import { validateQuery } from '../middleware/validate.js';

const router = Router();

const listSchema = z.object({
  unreadOnly: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(30),
});

router.get(
  '/',
  requireAuth(),
  requireProfile,
  validateQuery(listSchema),
  asyncHandler(async (req, res) => {
    const profile = (req as AuthedRequest).profile;
    const q = req.query as unknown as z.infer<typeof listSchema>;

    let builder = supabase
      .from('notifications')
      .select('*')
      .eq('profile_id', profile.id)
      .order('created_at', { ascending: false })
      .limit(q.limit);

    if (q.unreadOnly === 'true') builder = builder.is('read_at', null);

    const { data, error } = await builder;
    if (error) return res.status(500).json({ success: false, message: 'Could not load notifications' });

    const unread = (data ?? []).filter((n) => !n.read_at).length;
    return res.status(200).json({ success: true, notifications: data ?? [], unread });
  })
);

router.patch(
  '/read-all',
  requireAuth(),
  requireProfile,
  asyncHandler(async (req, res) => {
    const profile = (req as AuthedRequest).profile;
    const { error } = await supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('profile_id', profile.id)
      .is('read_at', null);
    if (error) return res.status(500).json({ success: false, message: 'Could not update notifications' });
    return res.status(200).json({ success: true });
  })
);

router.patch(
  '/:id/read',
  requireAuth(),
  requireProfile,
  asyncHandler(async (req, res) => {
    const profile = (req as AuthedRequest).profile;
    const { data, error } = await supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('profile_id', profile.id)
      .select('*')
      .maybeSingle();
    if (error) return res.status(500).json({ success: false, message: 'Could not update notification' });
    if (!data) return res.status(404).json({ success: false, message: 'Notification not found' });
    return res.status(200).json({ success: true, notification: data });
  })
);

export default router;
