import { supabase } from "./lib/supabase.js";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";
import {
  clerkMiddleware,
  requireAuth,
  getAuth,
  clerkClient,
} from "@clerk/express";


dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 5000;

app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(
  clerkMiddleware({
    publishableKey: process.env.CLERK_PUBLISHABLE_KEY,
    secretKey: process.env.CLERK_SECRET_KEY,
  })
);

app.get("/api/health", (_req, res) => {
  res.status(200).json({
    success: true,
    message: "Cab Booking API is running!",
    timestamp: new Date().toISOString(),
  });
});

app.get("/api/db-health", async (_req, res) => {
  try {
    const { error } = await supabase
      .from("profiles")
      .select("id")
      .limit(1);

    if (error) {
      console.error("Database query failed:", error.message);

      return res.status(500).json({
        success: false,
        message: "Database query failed",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Supabase connection successful",
    });
  } catch (error) {
    console.error("Database connection failed:", error);

    return res.status(500).json({
      success: false,
      message: "Database connection failed",
    });
  }
});


app.post("/api/profile/sync", requireAuth(), async (req, res) => {
  try {
    const { userId } = getAuth(req);

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    // Get verified profile information from Clerk.
    const client = await clerkClient;
    const clerkUser = await client.users.getUser(userId);

    const fullName =
      [clerkUser.firstName, clerkUser.lastName]
        .filter(Boolean)
        .join(" ") || "New Rider";

    const email =
      clerkUser.primaryEmailAddress?.emailAddress ?? null;

    const phone =
      clerkUser.primaryPhoneNumber?.phoneNumber ?? null;

    const avatarUrl = clerkUser.imageUrl ?? null;

    // Look for an existing application profile.
    const { data: existing, error: lookupError } = await supabase
      .from("profiles")
      .select("id, role")
      .eq("clerk_user_id", userId)
      .maybeSingle();

    if (lookupError) {
      console.error("Profile lookup failed:", lookupError.message);
      return res.status(500).json({
        success: false,
        message: "Could not retrieve profile",
      });
    }

    if (existing) {
      // Update profile details without changing the user's role.
      const { data, error } = await supabase
        .from("profiles")
        .update({
          full_name: fullName,
          email,
          phone,
          avatar_url: avatarUrl,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id)
        .select("id, full_name, email, role")
        .single();

      if (error) {
        console.error("Profile update failed:", error.message);
        return res.status(500).json({
          success: false,
          message: "Could not update profile",
        });
      }

      return res.status(200).json({
        success: true,
        message: "Profile synchronized",
        profile: data,
      });
    }

    // New accounts always start as riders.
    const { data, error } = await supabase
      .from("profiles")
      .insert({
        clerk_user_id: userId,
        full_name: fullName,
        email,
        phone,
        avatar_url: avatarUrl,
        role: "rider",
      })
      .select("id, full_name, email, role")
      .single();

    if (error) {
      console.error("Profile creation failed:", error.message);
      return res.status(500).json({
        success: false,
        message: "Could not create profile",
      });
    }

    return res.status(201).json({
      success: true,
      message: "Profile created",
      profile: data,
    });
  } catch (error) {
    console.error("Profile sync failed:", error);

    return res.status(500).json({
      success: false,
      message: "Profile synchronization failed",
    });
  }
});


app.get("/api/rides", requireAuth(), async (req, res) => {
  try {
    const { userId } = getAuth(req);

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id")
      .eq("clerk_user_id", userId)
      .maybeSingle();

    if (profileError) {
      console.error("Ride history profile lookup failed:", profileError.message);

      return res.status(500).json({
        success: false,
        message: "Could not verify rider profile",
      });
    }

    if (!profile) {
      return res.status(403).json({
        success: false,
        message: "Please synchronize your profile first",
      });
    }

    const { data: rides, error: ridesError } = await supabase
      .from("rides")
      .select(
        "id, pickup_address, dropoff_address, vehicle_type, estimated_fare, currency, status, requested_at"
      )
      .eq("rider_id", profile.id)
      .order("requested_at", { ascending: false });

    if (ridesError) {
      console.error("Ride history query failed:", ridesError.message);

      return res.status(500).json({
        success: false,
        message: "Could not retrieve ride history",
      });
    }

    return res.status(200).json({
      success: true,
      rides: rides ?? [],
    });
  } catch (error) {
    console.error("Ride history request failed:", error);

    return res.status(500).json({
      success: false,
      message: "Could not retrieve ride history",
    });
  }
});



app.listen(PORT, () => {
  console.log(`Cab Booking API running at http://localhost:${PORT}`);
});

app.get("/api/protected", requireAuth(), (req, res) => {
  res.json({
    success: true,
    message: "You are authenticated!",
  });
});


app.post("/api/rides", requireAuth(), async (req, res) => {
  try {
    const { userId } = getAuth(req);

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const { pickup, destination, rideType } = req.body;

    if (
      typeof pickup !== "string" ||
      typeof destination !== "string" ||
      !pickup.trim() ||
      !destination.trim()
    ) {
      return res.status(400).json({
        success: false,
        message: "Pickup and destination are required",
      });
    }

    if (pickup.trim().length > 300 || destination.trim().length > 300) {
      return res.status(400).json({
        success: false,
        message: "Locations must be 300 characters or fewer",
      });
    }

    if (
      pickup.trim().toLowerCase() ===
      destination.trim().toLowerCase()
    ) {
      return res.status(400).json({
        success: false,
        message: "Pickup and destination must be different",
      });
    }

    const allowedRideTypes = ["standard","premium", "xl"];

    if (
      typeof rideType !== "string" ||
      !allowedRideTypes.includes(rideType)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid ride type",
      });
    }

    // Find the authenticated rider's application profile.
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id, role")
      .eq("clerk_user_id", userId)
      .maybeSingle();

    if (profileError) {
      console.error("Ride profile lookup failed:", profileError.message);

      return res.status(500).json({
        success: false,
        message: "Could not verify rider profile",
      });
    }

    if (!profile) {
      return res.status(403).json({
        success: false,
        message: "Please synchronize your profile before booking",
      });
    }

    if (profile.role !== "rider") {
      return res.status(403).json({
        success: false,
        message: "Only riders can request rides",
      });
    }

    // Save the ride request. Fare calculation will be added later.
    const { data: ride, error: rideError } = await supabase
  .from("rides")
  .insert({
    rider_id: profile.id,
    pickup_address: pickup.trim(),
    dropoff_address: destination.trim(),
    vehicle_type: rideType,
    estimated_fare: 0,
    discount_amount: 0,
    currency: "INR",
    status: "requested",
  })
  .select()
  .single();

    if (rideError) {
      console.error("Ride creation failed:", rideError.message);

      return res.status(500).json({
        success: false,
        message: "Could not create ride request",
      });
    }

    return res.status(201).json({
      success: true,
      message: "Ride request created",
      ride,
    });
  } catch (error) {
    console.error("Ride booking failed:", error);

    return res.status(500).json({
      success: false,
      message: "Ride booking failed",
    });
  }
});

