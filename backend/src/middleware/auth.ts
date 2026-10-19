import type { Request, RequestHandler } from "express";
import { getAuth } from "@clerk/express";
import { HttpError } from "../lib/http.js";
import { supabase } from "../lib/supabase.js";

export interface AuthProfile {
  id: string;
  clerk_user_id: string;
  role: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  avatar_url: string | null;
}

declare global {
  namespace Express {
    interface Request {
      profile?: AuthProfile;
    }
  }
}

export interface RequireProfileOptions {
  /** Message returned when the signed-in user has no profile row yet. */
  missingMessage?: string;
}

/**
 * Loads the caller's profile and attaches it to `req.profile`.
 * 401 when unauthenticated, 403 when the profile has not been synchronized.
 */
export function requireProfile(
  options: RequireProfileOptions = {}
): RequestHandler {
  const missingMessage =
    options.missingMessage ?? "Please synchronize your profile first";

  return async (req, _res, next) => {
    try {
      const { userId } = getAuth(req);

      if (!userId) {
        throw new HttpError(401, "Authentication required");
      }

      const { data, error } = await supabase
        .from("profiles")
        .select(
          "id, clerk_user_id, role, full_name, email, phone, avatar_url"
        )
        .eq("clerk_user_id", userId)
        .maybeSingle();

      if (error) {
        throw new HttpError(500, "Could not verify rider profile", {
          cause: error,
        });
      }

      if (!data) {
        throw new HttpError(403, missingMessage);
      }

      req.profile = data;
      next();
    } catch (error) {
      next(error);
    }
  };
}

/** Asserts `requireProfile` ran; use in handlers after it in the chain. */
export function getProfile(req: Request): AuthProfile {
  if (!req.profile) {
    throw new HttpError(403, "Profile required");
  }

  return req.profile;
}

/** Requires `req.profile` (run `requireProfile` first) to hold one of `roles`. */
export function requireRole(
  roles: readonly string[],
  message = "You do not have permission to perform this action"
): RequestHandler {
  return (req, _res, next) => {
    if (!req.profile) {
      next(new HttpError(403, "Profile required"));
      return;
    }

    if (!roles.includes(req.profile.role)) {
      next(new HttpError(403, message));
      return;
    }

    next();
  };
}
