import { Router } from 'express';
import { requireAuth } from '@clerk/express';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';
import { asyncHandler } from '../lib/http.js';
import { requireProfile, AuthedRequest } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { createNotification } from '../services/notifications.js';
import { notifyProfile } from '../services/realtime.js';

const router = Router();

const reviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(1000).optional(),
});

router.post(
  '/rides/:id/review',
  requireAuth(),
  requireProfile,
  validateBody(reviewSchema),
  asyncHandler(async (req, res) => {
    const profile = (req as AuthedRequest).profile;
    const body = req.body as z.infer<typeof reviewSchema>;

    const { data: ride } = await supabase.from('rides').select('*').eq('id', req.params.id).maybeSingle();
    if (!ride) return res.status(404).json({ success: false, message: 'Ride not found' });
    if (ride.rider_id !== profile.id) return res.status(403).json({ success: false, message: 'Only the rider can review this ride' });
    if (ride.status !== 'completed') return res.status(409).json({ success: false, message: 'You can review a ride after it is completed' });
    if (!ride.driver_id) return res.status(409).json({ success: false, message: 'This ride has no driver to review' });

    const { data: existing } = await supabase.from('reviews').select('id').eq('ride_id', ride.id).maybeSingle();
    if (existing) return res.status(409).json({ success: false, message: 'This ride has already been reviewed' });

    const { data: review, error } = await supabase
      .from('reviews')
      .insert({
        ride_id: ride.id,
        rider_id: profile.id,
        driver_id: ride.driver_id,
        rating: body.rating,
        comment: body.comment ?? null,
      })
      .select('*')
      .single();

    if (error) {
      console.error('Review insert failed:', error.message);
      return res.status(500).json({ success: false, message: 'Could not save review' });
    }

    const { data: all } = await supabase.from('reviews').select('rating').eq('driver_id', ride.driver_id);
    const count = all?.length ?? 0;
    const avg = count > 0 ? (all ?? []).reduce((s, r) => s + Number(r.rating), 0) / count : 0;

    await supabase
      .from('driver_profiles')
      .update({ rating_avg: Math.round(avg * 100) / 100, rating_count: count, updated_at: new Date().toISOString() })
      .eq('profile_id', ride.driver_id);

    await createNotification({
      profileId: ride.driver_id,
      rideId: ride.id,
      title: 'New review',
      body: `${profile.full_name} rated you ${body.rating}/5.`,
      type: 'review',
    });
    await notifyProfile(ride.driver_id, 'review:new', review);

    return res.status(201).json({ success: true, message: 'Review submitted', review, ratingAvg: avg, ratingCount: count });
  })
);

export default router;
