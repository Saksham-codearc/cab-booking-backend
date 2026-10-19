import { Router } from "express";
import { getAuth, requireAuth } from "@clerk/express";
import { HttpError, asyncHandler } from "../lib/http.js";
import { getProfile, requireProfile, requireRole } from "../middleware/auth.js";
import { writeLimiter } from "../middleware/rateLimit.js";
import { validateBody, validateParams, validateQuery } from "../middleware/validate.js";
import {
  historyQuerySchema,
  idParamSchema,
  rideRequestSchema,
  type HistoryQuery,
  type RideRequest,
} from "../lib/validation.js";
import { supabase } from "../lib/supabase.js";
import { quoteAll, type RideType } from "../services/fare.js";

export const ridesRouter = Router();

const RIDE_COLUMNS =
  "id, pickup_address, dropoff_address, vehicle_type, estimated_fare, currency, status, requested_at";

ridesRouter.get(
  "/rides",
  requireAuth(),
  requireProfile({ missingMessage: "Please synchronize your profile first" }),
  asyncHandler(async (req, res) => {
    const profile = getProfile(req);

    const { data: rides, error } = await supabase
      .from("rides")
      .select(RIDE_COLUMNS)
      .eq("rider_id", profile.id)
      .order("requested_at", { ascending: false });

    if (error) {
      throw new HttpError(500, "Could not retrieve ride history", {
        cause: error,
      });
    }

    res.status(200).json({
      success: true,
      rides: rides ?? [],
    });
  })
);

// Registered before GET /rides/:id so "history" is not treated as an id.
ridesRouter.get(
  "/rides/history",
  requireAuth(),
  requireProfile({ missingMessage: "Please synchronize your profile first" }),
  validateQuery(historyQuerySchema),
  asyncHandler(async (req, res) => {
    const profile = getProfile(req);
    const { page, limit } = req.query as unknown as HistoryQuery;

    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const { data: rides, error, count } = await supabase
      .from("rides")
      .select(RIDE_COLUMNS, { count: "exact" })
      .eq("rider_id", profile.id)
      .order("requested_at", { ascending: false })
      .range(from, to);

    if (error) {
      throw new HttpError(500, "Could not retrieve ride history", {
        cause: error,
      });
    }

    const total = count ?? 0;

    res.status(200).json({
      success: true,
      rides: rides ?? [],
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  })
);

ridesRouter.get(
  "/rides/:id",
  requireAuth(),
  requireProfile({ missingMessage: "Please synchronize your profile first" }),
  validateParams(idParamSchema),
  asyncHandler(async (req, res) => {
    const profile = getProfile(req);
    const { id } = req.params as { id: string };

    const { data: ride, error } = await supabase
      .from("rides")
      .select(RIDE_COLUMNS)
      .eq("id", id)
      .eq("rider_id", profile.id)
      .maybeSingle();

    if (error) {
      throw new HttpError(500, "Could not retrieve the ride", {
        cause: error,
      });
    }

    if (!ride) {
      throw new HttpError(404, "Ride not found");
    }

    res.status(200).json({ success: true, ride });
  })
);

ridesRouter.post(
  "/rides",
  writeLimiter,
  requireAuth(),
  validateBody(rideRequestSchema),
  requireProfile({
    missingMessage: "Please synchronize your profile before booking",
  }),
  requireRole(["rider"], "Only riders can request rides"),
  asyncHandler(async (req, res) => {
    const profile = getProfile(req);
    const { pickup, destination, rideType } = req.body as RideRequest;

    // Fare is always calculated server-side; the client never sends a price.
    const quote = await quoteAll(pickup, destination);
    const estimatedFare = quote.fares[rideType as RideType];

    const { data: ride, error } = await supabase
      .from("rides")
      .insert({
        rider_id: profile.id,
        pickup_address: pickup,
        dropoff_address: destination,
        vehicle_type: rideType,
        estimated_fare: estimatedFare,
        discount_amount: 0,
        currency: quote.currency,
        status: "requested",
      })
      .select()
      .single();

    if (error) {
      throw new HttpError(500, "Could not create ride request", {
        cause: error,
      });
    }

    res.status(201).json({
      success: true,
      message: "Ride request created",
      ride,
    });
  })
);

ridesRouter.post(
  "/rides/:id/cancel",
  writeLimiter,
  requireAuth(),
  requireProfile({ missingMessage: "Please synchronize your profile first" }),
  validateParams(idParamSchema),
  asyncHandler(async (req, res) => {
    const profile = getProfile(req);
    const { id } = req.params as { id: string };

    const { data: existing, error: lookupError } = await supabase
      .from("rides")
      .select("id, status")
      .eq("id", id)
      .eq("rider_id", profile.id)
      .maybeSingle();

    if (lookupError) {
      throw new HttpError(500, "Could not retrieve the ride", {
        cause: lookupError,
      });
    }

    if (!existing) {
      throw new HttpError(404, "Ride not found");
    }

    if (existing.status !== "requested") {
      throw new HttpError(409, "This ride can no longer be cancelled");
    }

    // Conditional update keeps cancellation race-safe.
    const { data: ride, error: updateError } = await supabase
      .from("rides")
      .update({ status: "cancelled" })
      .eq("id", id)
      .eq("status", "requested")
      .select(RIDE_COLUMNS)
      .maybeSingle();

    if (updateError) {
      throw new HttpError(500, "Could not cancel the ride", {
        cause: updateError,
      });
    }

    if (!ride) {
      throw new HttpError(409, "This ride can no longer be cancelled");
    }

    res.status(200).json({
      success: true,
      message: "Ride cancelled",
      ride,
    });
  })
);
