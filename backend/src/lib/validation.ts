import { z } from "zod";

export const ALLOWED_RIDE_TYPES = ["standard", "premium", "xl"] as const;

export const rideRequestSchema = z
  .object({
    pickup: z
      .string()
      .trim()
      .min(1, "Pickup and destination are required")
      .max(300, "Locations must be 300 characters or fewer"),
    destination: z
      .string()
      .trim()
      .min(1, "Pickup and destination are required")
      .max(300, "Locations must be 300 characters or fewer"),
    rideType: z.enum(ALLOWED_RIDE_TYPES, "Invalid ride type"),
  })
  .refine(
    (data) => data.pickup.toLowerCase() !== data.destination.toLowerCase(),
    {
      message: "Pickup and destination must be different",
      path: ["destination"],
    }
  );

export type RideRequest = z.infer<typeof rideRequestSchema>;

export function firstIssueMessage(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Invalid request";
}
