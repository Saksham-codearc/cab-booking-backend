import env from '../config/env.js';

export type RideType = 'standard' | 'premium' | 'xl';
export interface FareInput {
  distanceKm: number;
  durationMin: number;
  rideType: RideType;
}

const BASE: Record<RideType, number> = {
  standard: 40,
  premium: 70,
  xl: 120,
};
const PER_KM: Record<RideType, number> = {
  standard: 15,
  premium: 25,
  xl: 35,
};
const PER_MIN: Record<RideType, number> = {
  standard: 2,
  premium: 3,
  xl: 4,
};

export function calculateFare(input: FareInput) {
  const dist = Number(input.distanceKm) || 0;
  const dur = Number(input.durationMin) || 0;
  const base = BASE[input.rideType] ?? 40;
  const perKm = PER_KM[input.rideType] ?? 15;
  const perMin = PER_MIN[input.rideType] ?? 2;
  const estimated = base + dist * perKm + dur * perMin;
  const feePct = env.PLATFORM_FEE_PERCENT || 20;
  const platformFee = estimated * (feePct / 100);
  const driverEarnings = estimated - platformFee;
  return {
    estimatedFare: Math.round(estimated * 100) / 100,
    baseFare: base,
    platformFee: Math.round(platformFee * 100) / 100,
    driverEarnings: Math.round(driverEarnings * 100) / 100,
    surgeMultiplier: 1.0,
    currency: 'INR',
    finalFare: Math.round(estimated * 100) / 100,
  };
}
