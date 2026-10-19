import { Router } from "express";
import { HttpError, asyncHandler } from "../lib/http.js";
import { supabase } from "../lib/supabase.js";

export const healthRouter = Router();

healthRouter.get("/health", (_req, res) => {
  res.status(200).json({
    success: true,
    message: "Cab Booking API is running!",
    timestamp: new Date().toISOString(),
  });
});

healthRouter.get(
  "/db-health",
  asyncHandler(async (_req, res) => {
    const { error } = await supabase.from("profiles").select("id").limit(1);

    if (error) {
      throw new HttpError(500, "Database query failed", { cause: error });
    }

    res.status(200).json({
      success: true,
      message: "Supabase connection successful",
    });
  })
);
