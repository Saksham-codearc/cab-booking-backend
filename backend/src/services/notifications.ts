import { supabase } from '../lib/supabase.js';
import { notifyProfile } from './realtime.js';

export async function createNotification(input: {
  profileId: string;
  rideId?: string | null;
  title: string;
  body: string;
  type?: string;
}) {
  const { data, error } = await supabase
    .from('notifications')
    .insert({
      profile_id: input.profileId,
      ride_id: input.rideId ?? null,
      title: input.title,
      body: input.body,
      type: input.type ?? 'ride',
    })
    .select('*')
    .single();

  if (error) {
    console.error('Notification insert failed:', error.message);
    return null;
  }

  await notifyProfile(input.profileId, 'notification:new', data as Record<string, unknown>);
  return data;
}
