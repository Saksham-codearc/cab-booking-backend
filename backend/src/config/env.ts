import "dotenv/config";
import { z } from "zod";

// Treat blank values as missing so defaults still apply.
function emptyToUndefined(value: unknown): unknown {
  return typeof value === "string" && value.trim() === "" ? undefined : value;
}

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(5000),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
  CLERK_PUBLISHABLE_KEY: z.string().min(1, "is required"),
  CLERK_SECRET_KEY: z.string().min(1, "is required"),
  SUPABASE_URL: z.url("must be a valid URL"),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, "is required"),
});

const parsed = envSchema.safeParse({
  PORT: emptyToUndefined(process.env.PORT),
  CORS_ORIGIN: emptyToUndefined(process.env.CORS_ORIGIN),
  CLERK_PUBLISHABLE_KEY: emptyToUndefined(process.env.CLERK_PUBLISHABLE_KEY),
  CLERK_SECRET_KEY: emptyToUndefined(process.env.CLERK_SECRET_KEY),
  SUPABASE_URL: emptyToUndefined(process.env.SUPABASE_URL),
  SUPABASE_SERVICE_ROLE_KEY: emptyToUndefined(
    process.env.SUPABASE_SERVICE_ROLE_KEY
  ),
});

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
    .join("\n");

  throw new Error(`Invalid environment variables:\n${details}`);
}

export const env = {
  port: parsed.data.PORT,
  corsOrigins: parsed.data.CORS_ORIGIN.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  clerkPublishableKey: parsed.data.CLERK_PUBLISHABLE_KEY,
  clerkSecretKey: parsed.data.CLERK_SECRET_KEY,
  supabaseUrl: parsed.data.SUPABASE_URL,
  supabaseServiceRoleKey: parsed.data.SUPABASE_SERVICE_ROLE_KEY,
} as const;
