import { env } from "../config/env.js";

export type RideType = "standard" | "premium" | "xl";

interface FareConfigEntry {
  base: number;
  perKm: number;
  min: number;
}

/** Fare inputs in INR. Server-side only — clients never send prices. */
export const FARE_CONFIG: Record<RideType, FareConfigEntry> = {
  standard: { base: 30, perKm: 12, min: 50 },
  premium: { base: 60, perKm: 18, min: 120 },
  xl: { base: 80, perKm: 20, min: 150 },
};

export const RIDE_TYPES = Object.keys(FARE_CONFIG) as RideType[];

export function quoteFare(type: RideType, distanceKm: number): number {
  const config = FARE_CONFIG[type];
  return Math.max(
    config.min,
    Math.round(config.base + config.perKm * Math.max(0, distanceKm))
  );
}

/** Distance between two WGS84 coordinates in kilometres. */
export function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const earthRadiusKm = 6371;

  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;

  return 2 * earthRadiusKm * Math.asin(Math.sqrt(h));
}

/** Deterministic string hash (FNV-1a) so fallback estimates never flicker. */
function stableHash(value: string): number {
  let hash = 0x811c9dc5;

  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }

  return Math.abs(hash);
}

export interface TripQuote {
  distanceKm: number;
  durationMin: number;
  currency: "INR";
  source: "google" | "heuristic";
  fares: Record<RideType, number>;
}

/**
 * Estimates a trip. Primary source is Google's Distance Matrix (requires
 * GOOGLE_MAPS_SERVER_KEY + billing); any failure falls back to a stable
 * heuristic so the booking flow never breaks. The source is always reported.
 */
export async function quoteAll(
  pickup: string,
  destination: string
): Promise<TripQuote> {
  const google = await googleDistance(pickup, destination);

  const { distanceKm, durationMin, source } =
    google ?? heuristicDistance(pickup, destination);

  return {
    distanceKm: Math.round(distanceKm * 100) / 100,
    durationMin: Math.round(durationMin),
    currency: "INR",
    source,
    fares: Object.fromEntries(
      RIDE_TYPES.map((type) => [type, quoteFare(type, distanceKm)])
    ) as Record<RideType, number>,
  };
}

async function googleDistance(
  pickup: string,
  destination: string
): Promise<{ distanceKm: number; durationMin: number; source: "google" } | null> {
  const key = env.mapsServerKey;

  if (!key) {
    return null;
  }

  try {
    const url = new URL(
      "https://maps.googleapis.com/maps/api/distancematrix/json"
    );
    url.searchParams.set("origins", pickup);
    url.searchParams.set("destinations", destination);
    url.searchParams.set("key", key);

    const response = await fetch(url, {
      signal: AbortSignal.timeout(5_000),
    });

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as {
      rows?: Array<{
        elements?: Array<{
          distance?: { value?: number };
          duration?: { value?: number };
          status?: string;
        }>;
      }>;
    };

    const element = data.rows?.[0]?.elements?.[0];

    if (
      element?.status !== "OK" ||
      typeof element.distance?.value !== "number" ||
      typeof element.duration?.value !== "number"
    ) {
      return null;
    }

    return {
      distanceKm: element.distance.value / 1000,
      durationMin: element.duration.value / 60,
      source: "google",
    };
  } catch {
    return null;
  }
}

function heuristicDistance(
  pickup: string,
  destination: string
): { distanceKm: number; durationMin: number; source: "heuristic" } {
  const distanceKm = 4 + (stableHash(`${pickup.trim().toLowerCase()}|${destination.trim().toLowerCase()}`) % 160) / 10;

  return {
    distanceKm,
    durationMin: Math.round((distanceKm / 25) * 60),
    source: "heuristic",
  };
}
