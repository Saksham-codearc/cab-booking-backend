-- RideFlow — reset the ride domain on the live dev project to the canonical schema.
--
-- WHY THIS EXISTS
-- The live Supabase project still has the early-day schema: `rides` without
-- distance/fare-breakdown/payment_status columns, `driver_profiles` built around
-- approval_status/average_rating/is_available, `payments` built around
-- provider/provider_payment_id, and none of ride_status_events/reviews/notifications.
-- supabase/migrations/20260120000000_init_schema.sql is the canonical schema the
-- current backend was written against, but it uses `create table if not exists`,
-- so it cannot retrofit tables that already exist.
--
-- WHAT THIS DOES (destructive, ride domain only)
--   * drops: rides, driver_profiles, payments, ride_status_events, reviews, notifications
--   * drops: ratings, vehicles, support_tickets, emergency_contacts (unused early tables)
--   * recreates them from the canonical definitions + indexes
--   * leaves `profiles` (and the Clerk-linked user in it) untouched
--
-- STATUS: NOT APPLIED. Run in the Supabase SQL editor, or via psql/CLI.
-- The project is effectively empty (1 profile, 0 drivers, 0 payments, 2 test rides),
-- so the only thing lost is test ride data.

begin;

-- 1. Drop the ride domain (children first) and the unused early tables.
drop table if exists public.ride_status_events cascade;
drop table if exists public.reviews            cascade;
drop table if exists public.notifications      cascade;
drop table if exists public.payments           cascade;
drop table if exists public.driver_profiles    cascade;
drop table if exists public.rides              cascade;
drop table if exists public.ratings            cascade;
drop table if exists public.vehicles           cascade;
drop table if exists public.support_tickets    cascade;
drop table if exists public.emergency_contacts cascade;

-- 2. Rides.
create table public.rides (
  id                 uuid primary key default gen_random_uuid(),
  rider_id           uuid references public.profiles(id) on delete restrict,
  driver_id          uuid references public.profiles(id) on delete restrict,
  pickup_address     text not null,
  dropoff_address    text not null,
  pickup_lat         double precision,
  pickup_lng         double precision,
  dropoff_lat        double precision,
  dropoff_lng        double precision,
  pickup_place_id    text,
  dropoff_place_id   text,
  distance_km        numeric(10,2),
  duration_min       integer,
  vehicle_type       text not null check (vehicle_type in ('standard','premium','xl')),
  estimated_fare     numeric(12,2) not null default 0,
  base_fare          numeric(12,2),
  surge_multiplier   numeric(4,2) default 1.0,
  platform_fee       numeric(12,2),
  driver_earnings    numeric(12,2),
  final_fare         numeric(12,2),
  discount_amount    numeric(12,2) not null default 0,
  currency           text not null default 'INR',
  status             text not null check (status in ('requested','accepted','arrived','in_progress','completed','cancelled')),
  payment_status     text not null check (payment_status in ('unpaid','authorized','paid','refunded','failed')) default 'unpaid',
  requested_at       timestamptz not null default now(),
  accepted_at        timestamptz,
  arrived_at         timestamptz,
  started_at         timestamptz,
  completed_at       timestamptz,
  cancelled_at       timestamptz,
  cancellation_reason text
);

-- 3. Driver profiles.
create table public.driver_profiles (
  profile_id          uuid primary key references public.profiles(id) on delete cascade,
  license_number      text,
  vehicle_make        text,
  vehicle_model       text,
  vehicle_plate       text,
  vehicle_type        text check (vehicle_type in ('standard','premium','xl')) default 'standard',
  is_online           boolean not null default false,
  is_verified         boolean not null default false,
  current_lat         double precision,
  current_lng         double precision,
  location_updated_at timestamptz,
  rating_avg          numeric(3,2) default 0,
  rating_count        integer default 0,
  total_trips         integer default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- 4. Payments (Razorpay).
create table public.payments (
  id                  uuid primary key default gen_random_uuid(),
  ride_id             uuid references public.rides(id) on delete cascade,
  provider            text not null default 'razorpay',
  razorpay_order_id   text,
  razorpay_payment_id text,
  razorpay_signature  text,
  amount              numeric(12,2) not null,
  currency            text not null default 'INR',
  status              text not null check (status in ('created','authorized','captured','failed','refunded')),
  method              text,
  platform_fee        numeric(12,2),
  driver_earnings     numeric(12,2),
  captured_at         timestamptz,
  receipt_url         text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- 5. Ride status audit trail.
create table public.ride_status_events (
  id         uuid primary key default gen_random_uuid(),
  ride_id    uuid references public.rides(id) on delete cascade,
  status     text not null,
  note       text,
  created_at timestamptz not null default now()
);

-- 6. Reviews.
create table public.reviews (
  id         uuid primary key default gen_random_uuid(),
  ride_id    uuid references public.rides(id) on delete cascade unique,
  rider_id   uuid references public.profiles(id) on delete cascade,
  driver_id  uuid references public.profiles(id) on delete cascade,
  rating     integer not null check (rating >= 1 and rating <= 5),
  comment    text,
  created_at timestamptz not null default now()
);

-- 7. Notifications.
create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles(id) on delete cascade,
  ride_id    uuid references public.rides(id) on delete cascade,
  title      text not null,
  body       text not null,
  type       text,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);

-- 8. Indexes.
create index if not exists idx_rides_status_requested_at on public.rides (status, requested_at desc);
create index if not exists idx_rides_rider_id            on public.rides (rider_id);
create index if not exists idx_rides_driver_id           on public.rides (driver_id);
create index if not exists idx_driver_profiles_online    on public.driver_profiles (is_online);
create index if not exists idx_driver_profiles_coords    on public.driver_profiles (current_lat, current_lng);
create index if not exists idx_payments_ride_id          on public.payments (ride_id);
create index if not exists idx_reviews_driver_id         on public.reviews (driver_id);
create index if not exists idx_notifications_profile_unread on public.notifications (profile_id, read_at);
create index if not exists idx_events_ride_id            on public.ride_status_events (ride_id);

commit;
