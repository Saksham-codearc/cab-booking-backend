-- Migration 002 — new tables: driver_profiles, ride_status_events, payments,
-- reviews, notifications (PLAN.md §3.2).
--
-- STATUS: NOT APPLIED. Run in the Supabase SQL editor (staging project first) or via
-- the Supabase CLI. Idempotent (IF NOT EXISTS).

create table if not exists public.driver_profiles (
  profile_id        uuid primary key references public.profiles(id) on delete cascade,
  license_number    text not null,
  vehicle_make      text not null,
  vehicle_model     text not null,
  vehicle_plate     text not null,
  vehicle_type      text not null default 'standard',
  is_online         boolean not null default false,
  is_verified       boolean not null default false,
  current_lat       double precision,
  current_lng       double precision,
  location_updated_at timestamptz,
  rating_avg        numeric(3,2) not null default 0,
  rating_count      integer not null default 0,
  total_trips       integer not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table if not exists public.ride_status_events (
  id          uuid primary key default gen_random_uuid(),
  ride_id     uuid not null references public.rides(id) on delete cascade,
  status      text not null,
  note        text,
  created_at  timestamptz not null default now()
);

create table if not exists public.payments (
  id                      uuid primary key default gen_random_uuid(),
  ride_id                 uuid not null unique references public.rides(id) on delete cascade,
  stripe_payment_intent_id text,
  amount                  numeric(12,2) not null,
  currency                text not null default 'INR',
  status                  text not null default 'unpaid',
  captured_at             timestamptz,
  receipt_url             text,
  created_at              timestamptz not null default now()
);

create table if not exists public.reviews (
  id          uuid primary key default gen_random_uuid(),
  ride_id     uuid not null unique references public.rides(id) on delete cascade,
  rider_id    uuid not null references public.profiles(id) on delete cascade,
  driver_id   uuid not null references public.profiles(id) on delete cascade,
  rating      integer not null check (rating between 1 and 5),
  comment     text,
  created_at  timestamptz not null default now()
);

create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  ride_id     uuid references public.rides(id) on delete cascade,
  title       text not null,
  body        text not null,
  type        text not null default 'info',
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
