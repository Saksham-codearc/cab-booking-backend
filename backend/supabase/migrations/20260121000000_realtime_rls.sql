-- Enable Realtime on key tables
alter publication supabase_realtime add table rides;
alter publication supabase_realtime add table notifications;
alter publication supabase_realtime add table ride_status_events;

-- RLS: service role bypasses; anon/authenticated under policies
alter table profiles enable row level security;
alter table driver_profiles enable row level security;
alter table rides enable row level security;
alter table ride_status_events enable row level security;
alter table payments enable row level security;
alter table reviews enable row level security;
alter table notifications enable row level security;

-- profiles: users can read/update their own
create policy "profiles select own" on profiles for select using (auth.uid() = clerk_user_id);
create policy "profiles update own" on profiles for update using (auth.uid() = clerk_user_id);

-- driver_profiles: related profile or driver
create policy "driver_profiles read related" on driver_profiles for select using (true);
create policy "driver_profiles update own" on driver_profiles for update using (exists (select 1 from profiles p where p.id=profile_id and p.clerk_user_id=auth.uid()));

-- rides: complex - owner/driver; allow select for relevant parties
create policy "rides select rider/driver" on rides for select using (
  exists (select 1 from profiles r where r.id=rider_id and r.clerk_user_id=auth.uid()) or
  exists (select 1 from profiles d where d.id=driver_id and d.clerk_user_id=auth.uid())
);
create policy "rides update rider/driver" on rides for update using (
  exists (select 1 from profiles r where r.id=rider_id and r.clerk_user_id=auth.uid()) or
  exists (select 1 from profiles d where d.id=driver_id and d.clerk_user_id=auth.uid())
);
create policy "rides insert rider" on rides for insert with check (
  exists (select 1 from profiles r where r.id=rider_id and r.clerk_user_id=auth.uid())
);

-- notifications: own
create policy "notifications own" on notifications for all using (exists (select 1 from profiles p where p.id=profile_id and p.clerk_user_id=auth.uid()));

-- reviews: read public
create policy "reviews read" on reviews for select using (true);
create policy "reviews insert own ride" on reviews for insert with check (
  exists (select 1 from profiles p where p.id=rider_id and p.clerk_user_id=auth.uid())
);

-- payments: own ride
create policy "payments own ride" on payments for select using (
  exists (select 1 from rides r join profiles p on p.id=r.rider_id or p.id=r.driver_id where r.id=ride_id and p.clerk_user_id=auth.uid())
);

-- events: read if own ride
create policy "events read own ride" on ride_status_events for select using (
  exists (select 1 from rides r join profiles p on p.id=r.rider_id or p.id=r.driver_id where r.id=ride_id and p.clerk_user_id=auth.uid())
);

-- available_rides view for online drivers (requested, unassigned)
create or replace view available_rides as
select r.id, r.rider_id, r.pickup_address, r.dropoff_address, r.pickup_lat, r.pickup_lng, r.dropoff_lat, r.dropoff_lng, r.distance_km, r.duration_min, r.vehicle_type, r.estimated_fare, r.currency, r.status, r.requested_at
from rides r
where r.status='requested' and r.driver_id is null;

grant select on available_rides to authenticated;
create policy "available_rides select drivers" on available_rides for select using (
  exists (select 1 from driver_profiles dp join profiles p on p.id=dp.profile_id where p.clerk_user_id=auth.uid() and dp.is_online and dp.is_verified)
);
