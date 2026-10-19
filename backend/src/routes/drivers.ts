import { Router } from 'express';
import { requireAuth } from '@clerk/express';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';
import { asyncHandler } from '../lib/http.js';
import { requireProfile, requireRole, AuthedRequest } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { haversineKm } from '../services/matching.js';

const router = Router();

const registerSchema = z.object({
  licenseNumber: z.string().trim().min(3).max(60),
  vehicleMake: z.string().trim().min(1).max(60),
  vehicleModel: z.string().trim().min(1).max(60),
  vehiclePlate: z.string().trim().min(2).max(30),
  vehicleType: z.enum(['standard', 'premium', 'xl']),
});

const statusSchema = z.object({
  isOnline: z.boolean(),
  lat: z.number().finite().min(-90).max(90).optional(),
  lng: z.number().finite().min(-180).max(180).optional(),
});

const locationSchema = z.object({
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
});

// Self-serve driver registration. Demo policy: auto-approve (is_verified = true).
router.post(
  '/register',
  requireAuth(),
  requireProfile,
  validateBody(registerSchema),
  asyncHandler(async (req, res) => {
    const profile = (req as AuthedRequest).profile;
    const body = req.body as z.infer<typeof registerSchema>;

    const { data: driver, error } = await supabase
      .from('driver_profiles')
      .upsert(
        {
          profile_id: profile.id,
          license_number: body.licenseNumber,
          vehicle_make: body.vehicleMake,
          vehicle_model: body.vehicleModel,
          vehicle_plate: body.vehiclePlate,
          vehicle_type: body.vehicleType,
          is_verified: true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'profile_id' }
      )
      .select('*')
      .single();

    if (error) {
      console.error('Driver registration failed:', error.message);
      return res.status(500).json({ success: false, message: 'Could not register as a driver' });
    }

    if (profile.role !== 'driver') {
      await supabase.from('profiles').update({ role: 'driver', updated_at: new Date().toISOString() }).eq('id', profile.id);
    }

    return res.status(200).json({ success: true, message: 'Driver profile saved', driver });
  })
);

router.get(
  '/me',
  requireAuth(),
  requireProfile,
  asyncHandler(async (req, res) => {
    const profile = (req as AuthedRequest).profile;
    const { data: driver } = await supabase.from('driver_profiles').select('*').eq('profile_id', profile.id).maybeSingle();

    const { data: completed } = await supabase
      .from('rides')
      .select('final_fare, driver_earnings, distance_km')
      .eq('driver_id', profile.id)
      .eq('status', 'completed');

    const earnings = (completed ?? []).reduce((sum, r) => sum + Number(r.driver_earnings ?? 0), 0);
    const trips = completed?.length ?? 0;

    return res.status(200).json({
      success: true,
      profile,
      driver: driver ?? null,
      stats: { earnings: Math.round(earnings * 100) / 100, trips, distanceKm: (completed ?? []).reduce((s, r) => s + Number(r.distance_km ?? 0), 0) },
    });
  })
);

router.patch(
  '/status',
  requireAuth(),
  requireProfile,
  requireRole('driver'),
  validateBody(statusSchema),
  asyncHandler(async (req, res) => {
    const profile = (req as AuthedRequest).profile;
    const body = req.body as z.infer<typeof statusSchema>;

    const updates: Record<string, unknown> = {
      is_online: body.isOnline,
      updated_at: new Date().toISOString(),
    };
    if (body.lat !== undefined && body.lng !== undefined) {
      updates.current_lat = body.lat;
      updates.current_lng = body.lng;
      updates.location_updated_at = new Date().toISOString();
    }

    const { data, error } = await supabase
      .from('driver_profiles')
      .update(updates)
      .eq('profile_id', profile.id)
      .select('*')
      .single();

    if (error) return res.status(500).json({ success: false, message: 'Could not update driver status' });
    return res.status(200).json({ success: true, driver: data });
  })
);

router.post(
  '/location',
  requireAuth(),
  requireProfile,
  requireRole('driver'),
  validateBody(locationSchema),
  asyncHandler(async (req, res) => {
    const profile = (req as AuthedRequest).profile;
    const body = req.body as z.infer<typeof locationSchema>;
    const { error } = await supabase
      .from('driver_profiles')
      .update({ current_lat: body.lat, current_lng: body.lng, location_updated_at: new Date().toISOString() })
      .eq('profile_id', profile.id);
    if (error) return res.status(500).json({ success: false, message: 'Could not update location' });
    return res.status(200).json({ success: true });
  })
);

// Nearby open ride requests for the authenticated driver.
router.get(
  '/requests',
  requireAuth(),
  requireProfile,
  requireRole('driver'),
  asyncHandler(async (req, res) => {
    const profile = (req as AuthedRequest).profile;

    const { data: driver } = await supabase.from('driver_profiles').select('*').eq('profile_id', profile.id).maybeSingle();
    if (!driver) return res.status(403).json({ success: false, message: 'Register as a driver first' });

    const { data: rides, error } = await supabase
      .from('rides')
      .select('*')
      .eq('status', 'requested')
      .is('driver_id', null)
      .order('requested_at', { ascending: false })
      .limit(30);

    if (error) return res.status(500).json({ success: false, message: 'Could not load ride requests' });

    const riderIds = Array.from(new Set((rides ?? []).map((r) => r.rider_id).filter(Boolean)));
    const { data: riders } = riderIds.length
      ? await supabase.from('profiles').select('id, full_name, avatar_url, phone').in('id', riderIds)
      : { data: [] as any[] };
    const riderMap = new Map((riders ?? []).map((r) => [r.id, r]));

    const enriched = (rides ?? []).map((ride) => {
      const distanceToPickup =
        driver.current_lat !== null && driver.current_lng !== null && ride.pickup_lat !== null && ride.pickup_lng !== null
          ? haversineKm(driver.current_lat, driver.current_lng, ride.pickup_lat, ride.pickup_lng)
          : null;
      return { ...ride, rider: riderMap.get(ride.rider_id) ?? null, distance_to_pickup_km: distanceToPickup };
    });

    enriched.sort((a, b) => {
      if (a.distance_to_pickup_km === null) return 1;
      if (b.distance_to_pickup_km === null) return -1;
      return a.distance_to_pickup_km - b.distance_to_pickup_km;
    });

    return res.status(200).json({ success: true, requests: enriched });
  })
);

// Public driver profile + recent reviews.
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { data: driver, error } = await supabase
      .from('driver_profiles')
      .select('*')
      .eq('profile_id', req.params.id)
      .maybeSingle();
    if (error) return res.status(500).json({ success: false, message: 'Could not load driver' });
    if (!driver) return res.status(404).json({ success: false, message: 'Driver not found' });

    const [{ data: profile }, { data: reviews }] = await Promise.all([
      supabase.from('profiles').select('id, full_name, avatar_url').eq('id', req.params.id).maybeSingle(),
      supabase
        .from('reviews')
        .select('id, rating, comment, created_at, rider_id')
        .eq('driver_id', req.params.id)
        .order('created_at', { ascending: false })
        .limit(20),
    ]);

    const riderIds = Array.from(new Set((reviews ?? []).map((r) => r.rider_id)));
    const { data: riders } = riderIds.length
      ? await supabase.from('profiles').select('id, full_name, avatar_url').in('id', riderIds)
      : { data: [] as any[] };
    const riderMap = new Map((riders ?? []).map((r) => [r.id, r]));

    return res.status(200).json({
      success: true,
      driver: { ...driver, profile },
      reviews: (reviews ?? []).map((r) => ({ ...r, rider: riderMap.get(r.rider_id) ?? null })),
    });
  })
);

export default router;
