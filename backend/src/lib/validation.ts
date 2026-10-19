import { z } from "zod";

export const ALLOWED_RIDE_TYPES = ["standard", "premium", "xl"] as const;

const locationString = z
  .string()
  .trim()
  .min(1, "Pickup and destination are required")
  .max(300, "Locations must be 300 characters or fewer");

const distinctLocations = z
  .object({
    pickup: locationString,
    destination: locationString,
  })
  .refine(
    (data) => data.pickup.toLowerCase() !== data.destination.toLowerCase(),
    {
      message: "Pickup and destination must be different",
      path: ["destination"],
    }
  );

export const rideRequestSchema = distinctLocations.extend({
  rideType: z.enum(ALLOWED_RIDE_TYPES, "Invalid ride type"),
});

export const estimateRequestSchema = distinctLocations;

export type RideRequest = z.infer<typeof rideRequestSchema>;
export type EstimateRequest = z.infer<typeof estimateRequestSchema>;

export const historyQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

export type HistoryQuery = z.infer<typeof historyQuerySchema>;

export const idParamSchema = z.object({
  id: z.string().trim().min(1, "Ride id is required"),
});

export function firstIssueMessage(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Invalid request";
}
