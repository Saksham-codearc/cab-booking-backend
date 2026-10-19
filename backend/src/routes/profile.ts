import { Router } from 'express';
import { requireAuth, getAuth, clerkClient } from '@clerk/express';
import { supabase } from '../lib/supabase.js';
import { asyncHandler } from '../lib/http.js';
import { requireProfile, AuthedRequest } from '../middleware/auth.js';

const router = Router();

router.get('/profile/me', requireAuth(), requireProfile, (req, res) => {
  const profile = (req as AuthedRequest).profile;
  return res.status(200).json({ success: true, profile });
});

router.post('/profile/sync', requireAuth(), asyncHandler(async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ success: false, message: 'Authentication required' });

  const client = await clerkClient;
  const clerkUser = await client.users.getUser(userId);
  const fullName = [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(' ') || 'New Rider';
  const email = clerkUser.primaryEmailAddress?.emailAddress ?? null;
  const phone = clerkUser.primaryPhoneNumber?.phoneNumber ?? null;
  const avatarUrl = clerkUser.imageUrl ?? null;

  const { data: existing, error: lookupError } = await supabase
    .from('profiles')
    .select('id, role')
    .eq('clerk_user_id', userId)
    .maybeSingle();
  if (lookupError) return res.status(500).json({ success: false, message: 'Could not retrieve profile' });

  if (existing) {
    const { data, error } = await supabase
      .from('profiles')
      .update({ full_name: fullName, email, phone, avatar_url: avatarUrl, updated_at: new Date().toISOString() })
      .eq('id', existing.id)
      .select('id, full_name, email, role')
      .single();
    if (error) return res.status(500).json({ success: false, message: 'Could not update profile' });
    return res.status(200).json({ success: true, message: 'Profile synchronized', profile: data });
  }

  const { data, error } = await supabase
    .from('profiles')
    .insert({ clerk_user_id: userId, full_name: fullName, email, phone, avatar_url: avatarUrl, role: 'rider' })
    .select('id, full_name, email, role')
    .single();
  if (error) return res.status(500).json({ success: false, message: 'Could not create profile' });
  return res.status(201).json({ success: true, message: 'Profile created', profile: data });
}));

export default router;
