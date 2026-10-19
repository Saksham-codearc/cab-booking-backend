export function haversineKm(lat1:number, lng1:number, lat2:number, lng2:number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 100) / 100;
}

export interface NearbyDriver {
  profile_id: string;
  distance_km: number;
}

export function rankDrivers(
  origin: { lat: number; lng: number },
  drivers: Array<{ profile_id: string; current_lat: number | null; current_lng: number | null }>,
  radiusKm = 10
): NearbyDriver[] {
  return drivers
    .filter((d) => d.current_lat !== null && d.current_lng !== null)
    .map((d) => ({
      profile_id: d.profile_id,
      distance_km: haversineKm(origin.lat, origin.lng, d.current_lat as number, d.current_lng as number),
    }))
    .filter((d) => d.distance_km <= radiusKm)
    .sort((a, b) => a.distance_km - b.distance_km);
}
