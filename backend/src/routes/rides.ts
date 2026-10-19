import { Router } from 'express';
import { requireAuth } from '@clerk/express';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';
import { asyncHandler } from '../lib/http.js';
import { requireProfile, requireRole, AuthedRequest } from '../middleware/auth.js';
import { validateBody, validateQuery } from '../middleware/validate.js';
import { bookingLimiter, acceptLimiter } from '../middleware/rateLimit.js';
import { estimateRoute } from '../services/maps.js';
import { calculateFare, RideType } from '../services/fare.js';
import { rankDrivers } from '../services/matching.js';
import { notifyProfile, notifyRide } from '../services/realtime.js';
import { createNotification } from '../services/notifications.js';
import { transitionRide } from '../services/rideStatus.js';
import { getRazorpay, razorpayConfigured, toPaise } from '../services/payments.js';
import { sendReceiptEmail } from '../services/email.js';
import env from '../config/env.js';

const router = Router();

const locationSchema = z.object({
  address: z.string().trim().min(1).max(300),
  lat: z.number().finite().min(-90).max(90).optional(),
  lng: z.number().finite().min(-180).max(180).optional(),
  placeId: z.string().max(300).optional(),
});

const bookingSchema = z.object({
  pickup: z.union([z.string().trim().min(1).max(300), locationSchema]),
  dropoff: z.union([z.string().trim().min(1).max(300), locationSchema]).optional(),
  destination: z.union([z.string().trim().min(1).max(300), locationSchema]).optional(),
  rideType: z.enum(['standard', 'premium', 'xl']),
});

const listQuerySchema = z.object({
  role: z.enum(['rider', 'driver']).optional(),
  status: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

type RawLocation = string | { address: string; lat?: number; lng?: number; placeId?: string };

function normalizeLocation(value: RawLocation) {
  if (typeof value === 'string') {
    return { address: value.trim(), lat: null as number | null, lng: null as number | null, placeId: null as string | null };
  }
  return {
    address: value.address.trim(),
    lat: value.lat ?? null,
    lng: value.lng ?? null,
    placeId: value.placeId ?? null,
  };
}

function publicRide(ride: any) {
  return ride;
}

async function loadRidePeople(rides: any[]) {
  const ids = new Set<string>();
  for (const ride of rides) {
    if (ride.rider_id) ids.add(ride.rider_id);
    if (ride.driver_id) ids.add(ride.driver_id);
  }
  if (ids.size === 0) return rides;

  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, full_name, avatar_url, phone, role')
    .in('id', Array.from(ids));

  const byId = new Map((profiles ?? []).map((p) => [p.id, p]));
  return rides.map((ride) => ({
    ...ride,
    rider: ride.rider_id ? byId.get(ride.rider_id) ?? null : null,
    driver: ride.driver_id ? byId.get(ride.driver_id) ?? null : null,
  }));
}

type RideViewerResult =
  | { ride: any; error?: never; status?: never }
  | { error: string; status: number; ride?: never };

async function getRideForViewer(rideId: string, profile: any): Promise<RideViewerResult> {
  const { data: ride, error } = await supabase.from('rides').select('*').eq('id', rideId).maybeSingle();
  if (error) return { error: 'Could not load ride', status: 500 as const };
  if (!ride) return { error: 'Ride not found', status: 404 as const };

  const isRider = ride.rider_id === profile.id;
  const isDriver = ride.driver_id === profile.id;
  if (!isRider && !isDriver && profile.role !== 'admin') {
    return { error: 'You do not have access to this ride', status: 403 as const };
  }

  const [withPeople] = await loadRidePeople([ride]);
  return { ride: withPeople };
}

// ---------------------------------------------------------------- create ride
router.post(
  '/',
  requireAuth(),
  requireProfile,
  requireRole('rider', 'admin'),
  bookingLimiter,
  validateBody(bookingSchema),
  asyncHandler(async (req, res) => {
    const profile = (req as AuthedRequest).profile;
    const body = req.body as z.infer<typeof bookingSchema>;
    const pickup = normalizeLocation(body.pickup as RawLocation);
    const dropoffValue = body.dropoff ?? body.destination;
    if (!dropoffValue) {
      return res.status(400).json({ success: false, message: 'Drop-off is required' });
    }
    const dropoff = normalizeLocation(dropoffValue as RawLocation);

    if (pickup.address.toLowerCase() === dropoff.address.toLowerCase()) {
      return res.status(400).json({ success: false, message: 'Pickup and drop-off must be different' });
    }

    let distanceKm = 0;
    let durationMin = 0;
    let source: 'google' | 'estimate' = 'estimate';

    if (pickup.lat !== null && pickup.lng !== null && dropoff.lat !== null && dropoff.lng !== null) {
      const route = await estimateRoute(
        { lat: pickup.lat, lng: pickup.lng },
        { lat: dropoff.lat, lng: dropoff.lng }
      );
      distanceKm = route.distanceKm;
      durationMin = route.durationMin;
      source = route.source;
    }

    const fare = calculateFare({ distanceKm, durationMin, rideType: body.rideType as RideType });

    const { data: ride, error: rideError } = await supabase
      .from('rides')
      .insert({
        rider_id: profile.id,
        pickup_address: pickup.address,
        dropoff_address: dropoff.address,
        pickup_lat: pickup.lat,
        pickup_lng: pickup.lng,
        dropoff_lat: dropoff.lat,
        dropoff_lng: dropoff.lng,
        pickup_place_id: pickup.placeId,
        dropoff_place_id: dropoff.placeId,
        distance_km: distanceKm,
        duration_min: durationMin,
        vehicle_type: body.rideType,
        estimated_fare: fare.estimatedFare,
        base_fare: fare.baseFare,
        surge_multiplier: fare.surgeMultiplier,
        platform_fee: fare.platformFee,
        driver_earnings: fare.driverEarnings,
        currency: fare.currency,
        status: 'requested',
        payment_status: 'unpaid',
      })
      .select('*')
      .single();

    if (rideError || !ride) {
      console.error('Ride creation failed:', rideError?.message);
      return res.status(500).json({ success: false, message: 'Could not create ride request' });
    }

    await supabase.from('ride_status_events').insert({ ride_id: ride.id, status: 'requested', note: 'Ride requested' });

    // Create a Razorpay order with manual capture (funds authorized, captured on completion).
    let payment: Record<string, unknown> | null = null;
    if (razorpayConfigured() && fare.estimatedFare > 0) {
      try {
        const order = await getRazorpay().orders.create({
          amount: toPaise(fare.estimatedFare),
          currency: 'INR',
          receipt: `ride_${ride.id}`.slice(0, 40),
          notes: { rideId: ride.id, riderId: profile.id },
          payment_capture: 0,
        });
        const { data: paymentRow } = await supabase
          .from('payments')
          .insert({
            ride_id: ride.id,
            razorpay_order_id: order.id,
            amount: fare.estimatedFare,
            currency: 'INR',
            status: 'created',
            platform_fee: fare.platformFee,
            driver_earnings: fare.driverEarnings,
          })
          .select('*')
          .single();
        payment = {
          orderId: order.id,
          amount: fare.estimatedFare,
          currency: 'INR',
          keyId: env.RAZORPAY_KEY_ID,
          paymentRowId: paymentRow?.id ?? null,
        };
      } catch (error) {
        console.error('Razorpay order creation failed:', error);
      }
    }

    await createNotification({
      profileId: profile.id,
      rideId: ride.id,
      title: 'Ride requested',
      body: `Looking for a driver from ${pickup.address}.`,
      type: 'ride',
    });

    // Notify nearby online drivers (targeted, per-profile channels).
    let driversNotified = 0;
    if (pickup.lat !== null && pickup.lng !== null) {
      const { data: drivers } = await supabase
        .from('driver_profiles')
        .select('profile_id, current_lat, current_lng')
        .eq('is_online', true);

      const candidates = rankDrivers(
        { lat: pickup.lat, lng: pickup.lng },
        (drivers ?? []) as any,
        15
      );

      if (candidates.length > 0) {
        const { data: busy } = await supabase
          .from('rides')
          .select('driver_id')
          .in('driver_id', candidates.map((c) => c.profile_id))
          .in('status', ['accepted', 'arrived', 'in_progress']);
        const busyIds = new Set((busy ?? []).map((r) => r.driver_id).filter(Boolean));

        for (const candidate of candidates) {
          if (busyIds.has(candidate.profile_id)) continue;
          driversNotified += 1;
          await notifyProfile(candidate.profile_id, 'ride:available', {
            ...publicRide(ride),
            distance_to_pickup_km: candidate.distance_km,
          });
        }
      }
    }

    await notifyProfile(profile.id, 'ride:created', ride);

    return res.status(201).json({
      success: true,
      message: 'Ride request created',
      ride: publicRide(ride),
      fare,
      route: { distanceKm, durationMin, source },
      payment,
      driversNotified,
    });
  })
);

// ----------------------------------------------------------------- list rides
router.get(
  '/',
  requireAuth(),
  requireProfile,
  validateQuery(listQuerySchema),
  asyncHandler(async (req, res) => {
    const profile = (req as AuthedRequest).profile;
    const query = req.query as unknown as z.infer<typeof listQuerySchema>;
    const role = query.role ?? (profile.role === 'driver' ? 'driver' : 'rider');

    let builder = supabase
      .from('rides')
      .select('*')
      .order('requested_at', { ascending: false })
      .range(query.offset, query.offset + query.limit - 1);

    builder = role === 'driver' ? builder.eq('driver_id', profile.id) : builder.eq('rider_id', profile.id);
    if (query.status) builder = builder.eq('status', query.status);

    const { data: rides, error } = await builder;
    if (error) {
      console.error('Ride list failed:', error.message);
      return res.status(500).json({ success: false, message: 'Could not retrieve rides' });
    }

    return res.status(200).json({ success: true, rides: await loadRidePeople(rides ?? []) });
  })
);

// ------------------------------------------------------------- active ride
router.get(
  '/active',
  requireAuth(),
  requireProfile,
  asyncHandler(async (req, res) => {
    const profile = (req as AuthedRequest).profile;
    const column = profile.role === 'driver' ? 'driver_id' : 'rider_id';
    const { data, error } = await supabase
      .from('rides')
      .select('*')
      .eq(column, profile.id)
      .in('status', ['requested', 'accepted', 'arrived', 'in_progress'])
      .order('requested_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) return res.status(500).json({ success: false, message: 'Could not load active ride' });
    const ride = data ? (await loadRidePeople([data]))[0] : null;
    return res.status(200).json({ success: true, ride });
  })
);

// ---------------------------------------------------------------- ride detail
router.get(
  '/:id',
  requireAuth(),
  requireProfile,
  asyncHandler(async (req, res) => {
    const profile = (req as AuthedRequest).profile;
    const result = await getRideForViewer(String(req.params.id), profile);
    if ('error' in result) return res.status(result.status ?? 500).json({ success: false, message: result.error });

    const [events, review] = await Promise.all([
      supabase.from('ride_status_events').select('*').eq('ride_id', req.params.id).order('created_at', { ascending: true }),
      supabase.from('reviews').select('*').eq('ride_id', req.params.id).maybeSingle(),
    ]);

    return res.status(200).json({
      success: true,
      ride: result.ride,
      events: events.data ?? [],
      review: review.data ?? null,
    });
  })
);

// ----------------------------------------------------------------- accept ride
router.post(
  '/:id/accept',
  requireAuth(),
  requireProfile,
  requireRole('driver'),
  acceptLimiter,
  asyncHandler(async (req, res) => {
    const profile = (req as AuthedRequest).profile;

    const { data: driver } = await supabase
      .from('driver_profiles')
      .select('*')
      .eq('profile_id', profile.id)
      .maybeSingle();
    if (!driver) return res.status(403).json({ success: false, message: 'Register as a driver first' });

    const { data: current } = await supabase
      .from('rides')
      .select('id')
      .eq('driver_id', profile.id)
      .in('status', ['accepted', 'arrived', 'in_progress'])
      .maybeSingle();
    if (current) return res.status(409).json({ success: false, message: 'Finish your current ride before accepting another' });

    const now = new Date().toISOString();
    const { data: ride, error } = await supabase
      .from('rides')
      .update({ driver_id: profile.id, status: 'accepted', accepted_at: now })
      .eq('id', req.params.id)
      .eq('status', 'requested')
      .is('driver_id', null)
      .select('*')
      .maybeSingle();

    if (error) {
      console.error('Accept ride failed:', error.message);
      return res.status(500).json({ success: false, message: 'Could not accept ride' });
    }
    if (!ride) {
      return res.status(409).json({ success: false, message: 'This ride has already been accepted or cancelled' });
    }

    await supabase.from('ride_status_events').insert({ ride_id: ride.id, status: 'accepted', note: 'Driver accepted the ride' });
    await notifyRide(ride.id, 'ride:accepted', { ...ride, driver: { id: profile.id, full_name: profile.full_name } });
    await notifyProfile(ride.rider_id, 'ride:updated', ride);
    await notifyProfile(profile.id, 'ride:updated', ride);
    await createNotification({
      profileId: ride.rider_id,
      rideId: ride.id,
      title: 'Driver on the way',
      body: `${profile.full_name} accepted your ride and is heading to ${ride.pickup_address}.`,
      type: 'ride',
    });

    return res.status(200).json({ success: true, message: 'Ride accepted', ride });
  })
);

// ------------------------------------------------------- driver status steps
for (const [path, nextStatus] of [
  ['arrive', 'arrived'],
  ['start', 'in_progress'],
] as const) {
  router.post(
    `/:id/${path}`,
    requireAuth(),
    requireProfile,
    requireRole('driver'),
    asyncHandler(async (req, res) => {
      const profile = (req as AuthedRequest).profile;
      const { data: ride } = await supabase.from('rides').select('*').eq('id', req.params.id).maybeSingle();
      if (!ride) return res.status(404).json({ success: false, message: 'Ride not found' });
      if (ride.driver_id !== profile.id) return res.status(403).json({ success: false, message: 'This ride is not assigned to you' });

      const result = await transitionRide({ rideId: ride.id, to: nextStatus, profileId: profile.id });
      if (!result.ok) return res.status(result.status).json({ success: false, message: result.message });

      const messages: Record<string, string> = {
        arrived: 'Your driver has arrived.',
        in_progress: 'Your ride has started.',
      };
      await createNotification({
        profileId: ride.rider_id,
        rideId: ride.id,
        title: nextStatus === 'arrived' ? 'Driver arrived' : 'Ride started',
        body: messages[nextStatus],
        type: 'ride',
      });

      return res.status(200).json({ success: true, ride: result.ride });
    })
  );
}

// -------------------------------------------------------------- complete ride
router.post(
  '/:id/complete',
  requireAuth(),
  requireProfile,
  requireRole('driver'),
  asyncHandler(async (req, res) => {
    const profile = (req as AuthedRequest).profile;
    const { data: ride } = await supabase.from('rides').select('*').eq('id', req.params.id).maybeSingle();
    if (!ride) return res.status(404).json({ success: false, message: 'Ride not found' });
    if (ride.driver_id !== profile.id) return res.status(403).json({ success: false, message: 'This ride is not assigned to you' });

    const finalFare = Number(ride.final_fare ?? ride.estimated_fare) || 0;
    const platformFee = Math.round(finalFare * (env.PLATFORM_FEE_PERCENT / 100) * 100) / 100;
    const driverEarnings = Math.round((finalFare - platformFee) * 100) / 100;

    // Capture an authorized Razorpay payment if one exists.
    let captured = false;
    let paymentId: string | undefined;
    const { data: paymentRow } = await supabase
      .from('payments')
      .select('*')
      .eq('ride_id', ride.id)
      .in('status', ['created', 'authorized'])
      .maybeSingle();

    if (paymentRow?.razorpay_payment_id && paymentRow.status === 'authorized' && razorpayConfigured()) {
      try {
        await getRazorpay().payments.capture(paymentRow.razorpay_payment_id, toPaise(finalFare), 'INR');
        captured = true;
        paymentId = paymentRow.razorpay_payment_id;
        await supabase
          .from('payments')
          .update({
            status: 'captured',
            amount: finalFare,
            platform_fee: platformFee,
            driver_earnings: driverEarnings,
            captured_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', paymentRow.id);
      } catch (error) {
        console.error('Razorpay capture failed:', error);
      }
    }

    const result = await transitionRide({
      rideId: ride.id,
      to: 'completed',
      profileId: profile.id,
      extra: {
        final_fare: finalFare,
        platform_fee: platformFee,
        driver_earnings: driverEarnings,
        ...(captured ? { payment_status: 'paid' } : {}),
      },
    });
    if (!result.ok) return res.status(result.status).json({ success: false, message: result.message });

    const { data: driverProfile } = await supabase
      .from('driver_profiles')
      .select('total_trips')
      .eq('profile_id', profile.id)
      .maybeSingle();

    await supabase
      .from('driver_profiles')
      .update({ total_trips: Number(driverProfile?.total_trips ?? 0) + 1, updated_at: new Date().toISOString() })
      .eq('profile_id', profile.id);

    const { data: rider } = await supabase.from('profiles').select('*').eq('id', ride.rider_id).maybeSingle();
    await createNotification({
      profileId: ride.rider_id,
      rideId: ride.id,
      title: 'Ride completed',
      body: `You arrived at ${ride.dropoff_address}. Total fare INR ${finalFare.toFixed(2)}.`,
      type: 'ride',
    });

    if (rider?.email) {
      try {
        await sendReceiptEmail({
          to: rider.email,
          riderName: rider.full_name ?? 'Rider',
          rideId: ride.id,
          pickup: ride.pickup_address,
          dropoff: ride.dropoff_address,
          distanceKm: Number(ride.distance_km ?? 0),
          fare: finalFare,
          paymentId,
          completedAt: new Date().toISOString(),
        });
      } catch (error) {
        console.error('Receipt email failed:', error);
      }
    }

    return res.status(200).json({ success: true, ride: result.ride, paymentCaptured: captured });
  })
);

// -------------------------------------------------------------- cancel ride
router.post(
  '/:id/cancel',
  requireAuth(),
  requireProfile,
  asyncHandler(async (req, res) => {
    const profile = (req as AuthedRequest).profile;
    const { data: ride } = await supabase.from('rides').select('*').eq('id', req.params.id).maybeSingle();
    if (!ride) return res.status(404).json({ success: false, message: 'Ride not found' });

    const isRider = ride.rider_id === profile.id;
    const isDriver = ride.driver_id === profile.id;
    if (!isRider && !isDriver) return res.status(403).json({ success: false, message: 'You do not have access to this ride' });
    if (ride.status === 'completed' || ride.status === 'cancelled') {
      return res.status(409).json({ success: false, message: 'Ride is already finished' });
    }
    if (isDriver && ride.status === 'in_progress') {
      return res.status(409).json({ success: false, message: 'A started ride cannot be cancelled by the driver' });
    }

    const result = await transitionRide({
      rideId: ride.id,
      to: 'cancelled',
      profileId: profile.id,
      note: isDriver ? 'Cancelled by driver' : 'Cancelled by rider',
    });
    if (!result.ok) return res.status(result.status).json({ success: false, message: result.message });

    await createNotification({
      profileId: isRider ? ride.rider_id : ride.rider_id,
      rideId: ride.id,
      title: 'Ride cancelled',
      body: isDriver ? 'Your driver cancelled the ride. Please book another ride.' : 'Your ride was cancelled.',
      type: 'ride',
    });
    if (ride.driver_id) {
      await createNotification({
        profileId: ride.driver_id,
        rideId: ride.id,
        title: 'Ride cancelled',
        body: 'The rider cancelled this ride.',
        type: 'ride',
      });
    }

    return res.status(200).json({ success: true, ride: result.ride });
  })
);

export default router;
