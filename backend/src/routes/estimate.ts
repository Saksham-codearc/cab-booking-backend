import { Router } from "express";
import { requireAuth } from "@clerk/express";
import { asyncHandler } from "../lib/http.js";
import { validateBody } from "../middleware/validate.js";
import { estimateRequestSchema, type EstimateRequest } from "../lib/validation.js";
import { quoteAll } from "../services/fare.js";

export const estimateRouter = Router();

// Mounted before ridesRouter so "/rides/estimate" never matches "/rides/:id".
estimateRouter.post(
  "/rides/estimate",
  requireAuth(),
  validateBody(estimateRequestSchema),
  asyncHandler(async (req, res) => {
    const { pickup, destination } = req.body as EstimateRequest;

    const estimate = await quoteAll(pickup, destination);

    res.status(200).json({
      success: true,
      estimate,
    });
  })
);
