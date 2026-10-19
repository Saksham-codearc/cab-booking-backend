-- Schema for RideFlow (Razorpay + Supabase Realtime)

-- profiles (Clerk-linked)
create table if not exists profiles (
  id uuid primary key default gen_random_uuid(),
  clerk_user_id text unique not null,
  full_name text not null,
  email text,
  phone text,
  avatar_url text,
  role text not null check (role in ('rider','driver','admin')),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- driver_profiles
create table if not exists driver_profiles (
  profile_id uuid primary key references profiles(id) on delete cascade,
  license_number text,
  vehicle_make text,
  vehicle_model text,
  vehicle_plate text,
  vehicle_type text check (vehicle_type in ('standard','premium','xl')) default 'standard',
  is_online boolean not null default false,
  is_verified boolean not null default false,
  current_lat double precision,
  current_lng double precision,
  location_updated_at timestamptz,
  rating_avg numeric(3,2) default 0,
  rating_count integer default 0,
  total_trips integer default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- rides
create table if not exists rides (
  id uuid primary key default gen_random_uuid(),
  rider_id uuid references profiles(id) on delete restrict,
  driver_id uuid references profiles(id) on delete restrict,
  pickup_address text not null,
  dropoff_address text not null,
  pickup_lat double precision,
  pickup_lng double precision,
  dropoff_lat double precision,
  dropoff_lng double precision,
  pickup_place_id text,
  dropoff_place_id text,
  distance_km numeric(10,2),
  duration_min integer,
  vehicle_type text not null check (vehicle_type in ('standard','premium','xl')),
  estimated_fare numeric(12,2) not null default 0,
  base_fare numeric(12,2),
  surge_multiplier numeric(4,2) default 1.0,
  platform_fee numeric(12,2),
  driver_earnings numeric(12,2),
  final_fare numeric(12,2),
  discount_amount numeric(12,2) not null default 0,
  currency text not null default 'INR',
  status text not null check (status in ('requested','accepted','arrived','in_progress','completed','cancelled')),
  payment_status text not null check (payment_status in ('unpaid','authorized','paid','refunded','failed')) default 'unpaid',
  requested_at timestamptz not null default now(),
  accepted_at timestamptz,
  arrived_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancellation_reason text
);

-- ride_status_events (audit)
create table if not exists ride_status_events (
  id uuid primary key default gen_random_uuid(),
  ride_id uuid references rides(id) on delete cascade,
  status text not null,
  note text,
  created_at timestamptz not null default now()
);

-- payments (Razorpay)
create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  ride_id uuid references rides(id) on delete cascade,
  provider text not null default 'razorpay',
  razorpay_order_id text,
  razorpay_payment_id text,
  razorpay_signature text,
  amount numeric(12,2) not null,
  currency text not null default 'INR',
  status text not null check (status in ('created','authorized','captured','failed','refunded')),
  method text,
  platform_fee numeric(12,2),
  driver_earnings numeric(12,2),
  captured_at timestamptz,
  receipt_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- reviews
create table if not exists reviews (
  id uuid primary key default gen_random_uuid(),
  ride_id uuid references rides(id) on delete cascade unique,
  rider_id uuid references profiles(id) on delete cascade,
  driver_id uuid references profiles(id) on delete cascade,
  rating integer not null check (rating >=1 and rating <=5),
  comment text,
  created_at timestamptz not null default now()
);

-- notifications
create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references profiles(id) on delete cascade,
  ride_id uuid references rides(id) on delete cascade,
  title text not null,
  body text not null,
  type text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

-- indexes
create index if not exists idx_rides_status_requested_at on rides (status, requested_at desc);
create index if not exists idx_rides_rider_id on rides (rider_id);
create index if not exists idx_rides_driver_id on rides (driver_id);
create index if not exists idx_driver_profiles_online on driver_profiles (is_online);
create index if not exists idx_driver_profiles_coords on driver_profiles (current_lat, current_lng);
create index if not exists idx_payments_ride_id on payments (ride_id);
create index if not exists idx_reviews_driver_id on reviews (driver_id);
create index if not exists idx_notifications_profile_unread on notifications (profile_id, read_at);
create index if not exists idx_events_ride_id on ride_status_events (ride_id);
