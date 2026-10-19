import { supabase } from '../lib/supabase.js';
import { notifyRide, notifyProfile } from './realtime.js';

export type RideStatus =
  | 'requested'
  | 'accepted'
  | 'arrived'
  | 'in_progress'
  | 'completed'
  | 'cancelled';

const TRANSITIONS: Record<RideStatus, RideStatus[]> = {
  requested: ['accepted', 'cancelled'],
  accepted: ['arrived', 'cancelled'],
  arrived: ['in_progress', 'cancelled'],
  in_progress: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

export function canTransition(from: RideStatus, to: RideStatus) {
  return (TRANSITIONS[from] ?? []).includes(to);
}

const TIMESTAMP_FIELD: Partial<Record<RideStatus, string>> = {
  accepted: 'accepted_at',
  arrived: 'arrived_at',
  in_progress: 'started_at',
  completed: 'completed_at',
  cancelled: 'cancelled_at',
};

export type RideTransitionResult =
  | { ok: true; ride: any }
  | { ok: false; status: number; message: string };

export async function transitionRide(input: {
  rideId: string;
  to: RideStatus;
  profileId: string;
  note?: string;
  extra?: Record<string, unknown>;
}): Promise<RideTransitionResult> {
  const { data: ride, error } = await supabase
    .from('rides')
    .select('*')
    .eq('id', input.rideId)
    .maybeSingle();

  if (error) throw new Error('Could not load ride');
  if (!ride) return { ok: false, status: 404, message: 'Ride not found' };

  const from = ride.status as RideStatus;
  if (!canTransition(from, input.to)) {
    return { ok: false, status: 409, message: `Cannot change ride from ${from} to ${input.to}` };
  }

  const now = new Date().toISOString();
  const updates: Record<string, unknown> = {
    status: input.to,
    ...input.extra,
  };
  const tsField = TIMESTAMP_FIELD[input.to];
  if (tsField) updates[tsField] = now;
  if (input.to === 'cancelled' && input.note) updates.cancellation_reason = input.note;

  // Conditional update prevents concurrent transitions on the same ride.
  const { data: updated, error: updateError } = await supabase
    .from('rides')
    .update(updates)
    .eq('id', input.rideId)
    .eq('status', from)
    .select('*')
    .single();

  if (updateError || !updated) {
    return { ok: false, status: 409, message: 'Ride was already updated. Refresh and try again.' };
  }

  await supabase.from('ride_status_events').insert({
    ride_id: updated.id,
    status: input.to,
    note: input.note ?? null,
  });

  await notifyRide(updated.id, `ride:${input.to}`, {
    rideId: updated.id,
    status: updated.status,
    driverId: updated.driver_id,
    occurredAt: now,
  });
  if (updated.rider_id) await notifyProfile(updated.rider_id, 'ride:updated', updated);
  if (updated.driver_id) await notifyProfile(updated.driver_id, 'ride:updated', updated);

  return { ok: true, ride: updated };
}
