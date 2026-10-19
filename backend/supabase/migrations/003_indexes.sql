-- Migration 003 — indexes for the hot queries (PLAN.md §3.3).
--
-- STATUS: NOT APPLIED. Run after migrations 001 and 002. Idempotent.

create index if not exists rides_status_requested_at_idx
  on public.rides (status, requested_at);
create index if not exists rides_rider_id_idx
  on public.rides (rider_id);
create index if not exists rides_driver_id_idx
  on public.rides (driver_id);

create index if not exists driver_profiles_is_online_idx
  on public.driver_profiles (is_online);
create index if not exists driver_profiles_location_idx
  on public.driver_profiles (current_lat, current_lng);

create index if not exists payments_ride_id_idx
  on public.payments (ride_id);

create index if not exists reviews_driver_id_idx
  on public.reviews (driver_id);

create index if not exists notifications_profile_read_idx
  on public.notifications (profile_id, read_at);
