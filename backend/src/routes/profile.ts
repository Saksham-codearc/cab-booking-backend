import { Router } from "express";
import { clerkClient, getAuth, requireAuth } from "@clerk/express";
import { HttpError, asyncHandler } from "../lib/http.js";
import { writeLimiter } from "../middleware/rateLimit.js";
import { supabase } from "../lib/supabase.js";

export const profileRouter = Router();

profileRouter.post(
  "/profile/sync",
  writeLimiter,
  requireAuth(),
  asyncHandler(async (req, res) => {
    const { userId } = getAuth(req);

    if (!userId) {
      throw new HttpError(401, "Authentication required");
    }

    // Get verified profile information from Clerk.
    const client = await clerkClient;
    const clerkUser = await client.users.getUser(userId);

    const fullName =
      [clerkUser.firstName, clerkUser.lastName]
        .filter(Boolean)
        .join(" ") || "New Rider";

    const email = clerkUser.primaryEmailAddress?.emailAddress ?? null;
    const phone = clerkUser.primaryPhoneNumber?.phoneNumber ?? null;
    const avatarUrl = clerkUser.imageUrl ?? null;

    // Look for an existing application profile.
    const { data: existing, error: lookupError } = await supabase
      .from("profiles")
      .select("id, role")
      .eq("clerk_user_id", userId)
      .maybeSingle();

    if (lookupError) {
      throw new HttpError(500, "Could not retrieve profile", {
        cause: lookupError,
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
        throw new HttpError(500, "Could not update profile", { cause: error });
      }

      res.status(200).json({
        success: true,
        message: "Profile synchronized",
        profile: data,
      });
      return;
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
      throw new HttpError(500, "Could not create profile", { cause: error });
    }

    res.status(201).json({
      success: true,
      message: "Profile created",
      profile: data,
    });
  })
);
