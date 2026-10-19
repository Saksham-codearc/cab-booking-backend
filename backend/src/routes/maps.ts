import { Router } from 'express';
import { z } from 'zod';
import { validateQuery } from '../middleware/validate.js';
import { asyncHandler } from '../lib/http.js';
import { estimateRoute } from '../services/maps.js';
import { calculateFare, RideType } from '../services/fare.js';

const router = Router();

const estimateSchema = z.object({
  pickupLat: z.coerce.number().finite().min(-90).max(90),
  pickupLng: z.coerce.number().finite().min(-180).max(180),
  dropoffLat: z.coerce.number().finite().min(-90).max(90),
  dropoffLng: z.coerce.number().finite().min(-180).max(180),
});

router.get(
  '/estimate',
  validateQuery(estimateSchema),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof estimateSchema>;
    const route = await estimateRoute(
      { lat: q.pickupLat, lng: q.pickupLng },
      { lat: q.dropoffLat, lng: q.dropoffLng }
    );

    const types: RideType[] = ['standard', 'premium', 'xl'];
    const fares = Object.fromEntries(
      types.map((type) => [type, calculateFare({ distanceKm: route.distanceKm, durationMin: route.durationMin, rideType: type })])
    );

    return res.status(200).json({ success: true, route, fares });
  })
);

export default router;
