import env from '../config/env.js';
import { haversineKm } from './matching.js';

export interface LatLng {
  lat: number;
  lng: number;
}

export interface RouteEstimate {
  distanceKm: number;
  durationMin: number;
  source: 'google' | 'estimate';
}

/**
 * Distance/duration between two points.
 * Uses Google Distance Matrix when a server key is configured, otherwise a
 * straight-line estimate with a 1.3x road factor.
 */
export async function estimateRoute(origin: LatLng, destination: LatLng): Promise<RouteEstimate> {
  const fallback = (): RouteEstimate => {
    const straight = haversineKm(origin.lat, origin.lng, destination.lat, destination.lng);
    const distanceKm = Math.round(straight * 1.3 * 100) / 100;
    const durationMin = Math.max(1, Math.round((distanceKm / 25) * 60));
    return { distanceKm, durationMin, source: 'estimate' };
  };

  if (!env.GOOGLE_MAPS_SERVER_KEY) return fallback();

  try {
    const url = new URL('https://maps.googleapis.com/maps/api/distancematrix/json');
    url.searchParams.set('origins', `${origin.lat},${origin.lng}`);
    url.searchParams.set('destinations', `${destination.lat},${destination.lng}`);
    url.searchParams.set('mode', 'driving');
    url.searchParams.set('key', env.GOOGLE_MAPS_SERVER_KEY);

    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    const data: any = await response.json();
    const element = data?.rows?.[0]?.elements?.[0];
    if (data?.status !== 'OK' || element?.status !== 'OK') return fallback();

    const meters = element.distance?.value;
    const seconds = element.duration?.value;
    if (!meters || !seconds) return fallback();

    return {
      distanceKm: Math.round((meters / 1000) * 100) / 100,
      durationMin: Math.max(1, Math.round(seconds / 60)),
      source: 'google',
    };
  } catch (error) {
    console.error('Distance Matrix failed, using estimate:', error);
    return fallback();
  }
}
