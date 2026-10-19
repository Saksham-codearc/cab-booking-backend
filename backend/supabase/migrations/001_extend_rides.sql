-- Migration 001 — extend `rides` with coordinates, distance, driver, fare breakdown,
-- payment status and status timestamps (PLAN.md §3.1).
--
-- STATUS: NOT APPLIED. Run in the Supabase SQL editor (staging project first) or via
-- the Supabase CLI. Uses IF NOT EXISTS so it is safe to re-run.
--
-- Status lifecycle: requested → accepted → arrived → in_progress → completed (plus cancelled).
-- payment_status lifecycle: unpaid → authorized → paid → refunded.

alter table public.rides
  add column if not exists pickup_lat           double precision,
  add column if not exists pickup_lng           double precision,
  add column if not exists dropoff_lat          double precision,
  add column if not exists dropoff_lng          double precision,
  add column if not exists pickup_place_id      text,
  add column if not exists dropoff_place_id     text,
  add column if not exists distance_km          numeric(10,2),
  add column if not exists duration_min         integer,
  add column if not exists driver_id            uuid references public.profiles(id),
  add column if not exists base_fare            numeric(12,2),
  add column if not exists surge_multiplier     numeric(4,2) default 1.0,
  add column if not exists platform_fee         numeric(12,2),
  add column if not exists driver_earnings      numeric(12,2),
  add column if not exists final_fare           numeric(12,2),
  add column if not exists payment_status       text not null default 'unpaid',
  add column if not exists accepted_at          timestamptz,
  add column if not exists arrived_at           timestamptz,
  add column if not exists started_at           timestamptz,
  add column if not exists completed_at         timestamptz,
  add column if not exists cancelled_at         timestamptz,
  add column if not exists cancellation_reason  text;
