import { supabase } from '../lib/supabase.js';

/**
 * Supabase Realtime Broadcast helper.
 * Backend broadcasts with the service role; frontend subscribes with the anon key.
 * Channel names use UUIDs so they are not guessable.
 */
export async function broadcast(channel: string, event: string, payload: Record<string, unknown>) {
  try {
    const ch = supabase.channel(channel);
    await ch.send({ type: 'broadcast', event, payload });
  } catch (e) {
    console.error('Realtime broadcast failed:', e);
  }
}

export function profileChannel(profileId: string) {
  return `profile:${profileId}`;
}

export function rideChannel(rideId: string) {
  return `ride:${rideId}`;
}

export async function notifyProfile(profileId: string, event: string, payload: Record<string, unknown>) {
  await broadcast(profileChannel(profileId), event, payload);
}

export async function notifyRide(rideId: string, event: string, payload: Record<string, unknown>) {
  await broadcast(rideChannel(rideId), event, payload);
}
