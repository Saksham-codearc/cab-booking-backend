import { Router } from "express";
import { getAuth, requireAuth } from "@clerk/express";
import { HttpError, asyncHandler } from "../lib/http.js";
import { getProfile, requireProfile, requireRole } from "../middleware/auth.js";
import { writeLimiter } from "../middleware/rateLimit.js";
import { validateBody } from "../middleware/validate.js";
import { rideRequestSchema, type RideRequest } from "../lib/validation.js";
import { supabase } from "../lib/supabase.js";

export const ridesRouter = Router();

ridesRouter.get(
  "/rides",
  requireAuth(),
  requireProfile({ missingMessage: "Please synchronize your profile first" }),
  asyncHandler(async (req, res) => {
    const profile = getProfile(req);

    const { data: rides, error } = await supabase
      .from("rides")
      .select(
        "id, pickup_address, dropoff_address, vehicle_type, estimated_fare, currency, status, requested_at"
      )
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

    // Fare calculation will be added in the maps/fare stage.
    const { data: ride, error } = await supabase
      .from("rides")
      .insert({
        rider_id: profile.id,
        pickup_address: pickup,
        dropoff_address: destination,
        vehicle_type: rideType,
        estimated_fare: 0,
        discount_amount: 0,
        currency: "INR",
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
