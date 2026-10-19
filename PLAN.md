# RideFlow — Days 4–14 Implementation Plan

> Status: **PLANNING ONLY — no code changes made yet.**
> Scope: everything from Day 4 (Maps & Ride Requests) through Day 14 (Deployment & Launch).

---

## 1. Current State (verified in repo)

### Backend (`backend/`)
- Express 5 + TypeScript (`NodeNext`, `.js` import suffixes, CommonJS package).
- Clerk auth (`@clerk/express`) + Supabase via **service-role** key.
- Installed but currently unused: `zod`, `express-rate-limit`, `socket.io`.
- All routes live in one file `src/index.ts` (~380 lines).

Endpoints that exist:
| Method | Path | Notes |
|---|---|---|
| GET | `/api/health` | ok |
| GET | `/api/db-health` | ok |
| POST | `/api/profile/sync` | creates/updates `profiles`, new users are `rider` |
| GET | `/api/rides` | rider's ride list |
| POST | `/api/rides` | creates ride, **fare hardcoded to 0**, no coordinates |
| GET | `/api/protected` | auth smoke test |

Known DB tables (inferred from code): `profiles` (id, clerk_user_id, full_name, email, phone, avatar_url, role, updated_at), `rides` (id, rider_id, pickup_address, dropoff_address, vehicle_type, estimated_fare, discount_amount, currency, status, requested_at).

### Frontend (`frontend/`)
- Next.js **16.4.2** App Router, React 19, Tailwind 4, Clerk 7, Google Maps JS loader 2.
- `src/app/dashboard/page.tsx` (~390 lines): booking form (text inputs only), ride list, static Delhi map.
- `src/components/GoogleMap.tsx`: basic map, no Places/Directions.
- `src/app/profile-test/page.tsx`: profile sync smoke test.
- **Important:** `frontend/AGENTS.md` says this Next.js version has breaking changes. All frontend work must follow `node_modules/next/dist/docs/` (note: request middleware lives in `src/proxy.ts` here, not `middleware.ts`).

### Gaps vs. the Day 4–14 brief
No coordinates/place IDs, no real fare calculation, no drivers table/role lifecycle, no matching, no status transitions, no realtime, no payments, no history/receipts, no reviews, no notifications, no tests, no deployment config.

---

## 2. Target Architecture

```
Rider (Next.js)                Driver (Next.js)
      │  Clerk JWT                    │  Clerk JWT
      └──────────────┬────────────────┘
                     ▼
        Express API (Render/Railway)
        ├── Zod validation + rate limits + role guards
        ├── Supabase Postgres (service role)
        ├── Google Maps (Places proxy, Distance/Directions)
        ├── Stripe (PaymentIntents + webhook)
        └── Socket.IO (rooms: ride:{id}, rider:{id}, driver:{id})
                     │
                     ▼
              Supabase Postgres
```

Key principles:
- Fare is **always** calculated server-side; client never sends prices.
- Ride status changes only through a validated state machine.
- Accepting a ride is race-safe (conditional update, not read-then-write).
- Every endpoint enforces ownership + role.

---

## 3. Database Changes (Supabase migrations)

Migration files will be added under `backend/supabase/migrations/` (SQL, run in Supabase SQL editor or CLI).

### 3.1 Extend `rides`
```sql
alter table rides
  add column pickup_lat      double precision,
  add column pickup_lng      double precision,
  add column dropoff_lat     double precision,
  add column dropoff_lng     double precision,
  add column pickup_place_id   text,
  add column dropoff_place_id  text,
  add column distance_km     numeric(10,2),
  add column duration_min    integer,
  add column driver_id       uuid references profiles(id),
  add column base_fare       numeric(12,2),
  add column surge_multiplier numeric(4,2) default 1.0,
  add column platform_fee    numeric(12,2),
  add column driver_earnings numeric(12,2),
  add column final_fare      numeric(12,2),
  add column payment_status  text not null default 'unpaid',
  add column accepted_at     timestamptz,
  add column arrived_at      timestamptz,
  add column started_at      timestamptz,
  add column completed_at    timestamptz,
  add column cancelled_at    timestamptz,
  add column cancellation_reason text;
```
Statuses: `requested → accepted → arrived → in_progress → completed` (plus `cancelled`).
`payment_status`: `unpaid → authorized → paid → refunded`.

### 3.2 New tables
- **`driver_profiles`** — profile_id (unique), license_number, vehicle_make/model/plate, vehicle_type, is_online, is_verified, current_lat/lng, location_updated_at, rating_avg, rating_count, total_trips.
- **`ride_status_events`** — ride_id, status, note, created_at (audit trail + UI timeline).
- **`payments`** — ride_id, stripe_payment_intent_id, amount, currency, status, captured_at, receipt_url.
- **`reviews`** — ride_id (unique), rider_id, driver_id, rating (1–5 check), comment, created_at.
- **`notifications`** — profile_id, ride_id, title, body, type, read_at, created_at.

### 3.3 Indexes
`rides(status, requested_at)`, `rides(rider_id)`, `rides(driver_id)`,
`driver_profiles(is_online)`, `driver_profiles(current_lat, current_lng)`,
`payments(ride_id)`, `reviews(driver_id)`, `notifications(profile_id, read_at)`.

---

## 4. Backend Refactor (foundation, do first)

Split `src/index.ts` into:

```
backend/src/
├─ index.ts                 # bootstrap only
├─ config/env.ts            # zod-validated environment
├─ lib/supabase.ts          # existing
├─ lib/http.ts              # asyncHandler, error helpers
├─ middleware/auth.ts       # requireProfile, requireRole('rider'|'driver'|'admin')
├─ middleware/validate.ts   # zod body/query/params
├─ middleware/rateLimit.ts  # per-route limiters
├─ middleware/error.ts      # centralized error handler
├─ routes/
│  ├─ health.ts
│  ├─ profile.ts
│  ├─ rides.ts
│  ├─ drivers.ts
│  ├─ maps.ts
│  ├─ payments.ts
│  ├─ reviews.ts
│  └─ notifications.ts
├─ services/
│  ├─ fare.ts               # fare table + calculation
│  ├─ matching.ts           # haversine + candidate query
│  ├─ rideStatus.ts         # state machine + timestamps + events
│  ├─ payments.ts           # Stripe intents/captures
│  └─ email.ts              # receipts
├─ sockets/index.ts         # Socket.IO auth + rooms + emits
└─ tests/                   # vitest + supertest
```

---

## 5. Day-by-Day Plan

### Day 4 — Maps & Ride Request System
**Goal:** real location selection, distance-based fare, coordinates stored.

Frontend
- `PlacesAutocomplete` component (new Places API via loader, India-biased).
- `RideMap`: pickup/drop markers + route polyline (Directions), auto fit-bounds.
- Booking form: pickup & drop search fields, swap button, ride type cards with live prices, submit.
- Show fare estimate + distance/duration before confirming.

Backend
- `GET /api/maps/estimate?pickupLat=..&dropoffLat=..` → distance, duration, per-type fares (Distance Matrix; key stays server-side).
- `POST /api/rides` accepts `pickup/dropoff {lat,lng,address,placeId}`, rideType → server calculates fare and inserts.
- `GET /api/rides/:id` (owner/driver/admin only).

Acceptance
- Booking from two searched places persists coords + non-zero fare; dashboard list shows it.

### Day 5 — Driver Dashboard & Matching
**Goal:** drivers go online, see nearby requests, accept race-safely, status flows.

Backend
- `POST /api/drivers/register` (vehicle + license), `PATCH /api/drivers/status` (online/offline + location).
- `GET /api/drivers/me`, `GET /api/drivers/requests` (nearby `requested` rides, sorted by haversine distance, excludes drivers already on a trip).
- `POST /api/rides/:id/accept` — conditional update `status='requested' and driver_id is null`; 409 if already taken.
- `POST /api/rides/:id/arrive|start|complete` and `/cancel` with role/ownership/state checks; writes `ride_status_events` + timestamps.
- Reject accepting new rides while driver has an active ride.

Frontend
- `/driver` dashboard: online toggle, current trip card with action buttons, nearby requests list, earnings summary.
- `/driver/onboarding` form.
- Role switch ("Become a driver") + rider/driver nav.

Acceptance
- Two riders' requests visible to an online driver; double-accept returns 409; rider dashboard reflects accepted driver + status.

### Day 6 — Real-Time Updates & Notifications
**Goal:** live status updates without refresh.

- Socket.IO on the same HTTP server; handshake auth via Clerk token; rooms `rider:{profileId}`, `driver:{profileId}`, `ride:{rideId}`.
- Events: `ride:requested`, `ride:accepted`, `ride:arrived`, `ride:started`, `ride:completed`, `ride:cancelled`, `notification:new`.
- Emit from services after DB writes (single source of truth).
- `notifications` table + `GET /api/notifications` + `PATCH /api/notifications/:id/read`.
- Frontend: socket hook with reconnect + **polling fallback every 15s**; toast notifications; bell with unread count.
- Rider live ride page `/rides/[id]`: map + timeline of statuses.

Acceptance
- Accepting in driver tab updates rider UI within ~1s; notifications persist across refresh.

### Day 7 — Buffer & Testing
- `vitest` + `supertest` setup.
- Unit tests: fare calculation (per type, rounding, min fare), haversine, status state machine, matching filter.
- Route tests: auth rejection, validation errors (400), role guards (403), double-accept (409) — Supabase and Clerk mocked.
- Manual smoke script: sign-up → sync profile → book → accept → complete.
- Fix defects surfaced here.

### Day 8 — Stripe Payments
- `stripe` SDK; test-mode keys.
- Flow: create PaymentIntent at booking (`capture_method: manual`, amount = estimated fare) → capture on `complete` → cancel on ride cancellation. Webhook `/api/payments/webhook` (raw body + signature verification) reconciles status.
- Store `payments` row; driver share = fare − platform fee (default 20%), credit `driver_earnings`.
- Frontend: payment step with Stripe Elements/Payment Element + payment status on ride/receipt.
- Driver payouts: internal earnings ledger for this scope (Stripe Connect noted as future work).

Acceptance
- Test card `4242…` authorizes at booking, captures on completion, declines handled cleanly, webhook idempotent.

### Day 9 — Ride History & Receipts
- `GET /api/rides/history?role=rider|driver&page=…` with pagination + filters (status/date).
- `GET /api/rides/:id/receipt` (JSON/HTML) + emailed receipt on completion.
- Frontend `/rides/history` (rider & driver tabs), receipt view, "email receipt" action.

### Day 10 — Ratings & Reviews
- `POST /api/rides/:id/review` (completed ride only, rider-owned, one per ride).
- Recompute `driver_profiles.rating_avg` / `rating_count` atomically (RPC or update from aggregate).
- `GET /api/drivers/:id` public profile with rating breakdown + recent reviews.
- Frontend: star rating modal after completion; stars on driver cards/profile.

### Day 11 — UI Enhancements & Responsiveness
- Extract shared UI: `RideCard`, `StatusBadge`, `StatusTimeline`, `EmptyState`, `Button`, `Input`, `Modal`, `Toast`.
- Mobile-first driver dashboard, sticky booking CTA, responsive grids, skeleton loaders, error boundaries, accessible labels/focus states.
- Consistent header/nav with role-aware links; empty/loading/error states everywhere.

### Day 12 — Security & Performance
- Zod validation on every route; rate limits (auth, booking, accept, payment); CORS allowlist from env.
- Ownership/role checks audited route-by-route; no mass assignment; secrets never returned.
- Helmet tuned for Google Maps/Stripe; Stripe webhook signature; input length caps.
- DB indexes above; `select` only needed columns; nearby-driver query via indexed RPC; pagination everywhere.
- Frontend: lazy-load map/socket, dynamic import, image/font hygiene, bundle check.
- Env audit: service-role key only backend; Maps server key restricted; `.env*` git-ignored.

### Day 13 — Final Testing & Bug Fixes
- Full-flow E2E (Clerk test user, rider + driver): sign-up → sync → driver online → book → accept → arrive → start → pay → complete → review → receipt.
- Negative tests: cancelled rides, expired auth, double booking, payment failure, unauthorized access.
- Cross-browser/mobile viewport pass; console/network error sweep; fix all blockers.

### Day 14 — Deployment & Launch
- Frontend → Vercel (`frontend/` root): env `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`.
- Backend → Render/Railway: build `npm run build`, start `npm start`, env secrets, health check `/api/health`, WebSocket support confirmed.
- Clerk production keys + allowed origins; Supabase migrations applied; Stripe live/test webhook endpoint registered.
- README: setup, env table, API reference, demo script, architecture diagram.
- Final demo + smoke test on production URLs.

---

## 6. New Environment Variables

Backend: `GOOGLE_MAPS_SERVER_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `PLATFORM_FEE_PERCENT`, `FRONTEND_URL` (CORS), `RESEND_API_KEY` (or SMTP_*), optional `DRIVER_SEARCH_RADIUS_KM`.
Frontend: `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (if Elements used).

---

## 7. Ordered Execution & Checkpoints

| Stage | Includes | Checkpoint |
|---|---|---|
| A. Foundation | env validation, route split, migrations, auth middleware | server builds, existing endpoints still work |
| B. Day 4 | maps estimate, places UI, fare service | booking with coords + fare |
| C. Day 5 | drivers, matching, status machine, driver UI | end-to-end accept/complete |
| D. Day 6 | socket.io + notifications | live updates <1s |
| E. Day 7 | tests | `npm test` green |
| F. Day 8–10 | Stripe, history/receipts, reviews | paid ride + receipt + rating |
| G. Day 11–12 | UI polish, security/perf | responsive pass, audit checklist |
| H. Day 13–14 | E2E, deploy | production demo |

Each stage ends with: build, lint, tests, manual smoke, short changelog note.

---

## 8. Decisions Needed Before Start

1. **Driver onboarding:** self-serve "Become a driver" (recommended) vs admin approval vs seeded test drivers.
2. **Payments:** Stripe test-mode PaymentIntents + internal earnings ledger (recommended for 2-week scope) vs full Stripe Connect payouts.
3. **Receipts email:** Resend (recommended, easy) vs Gmail/SMTP vs download-only receipt.
4. **Backend hosting:** Render (recommended, free tier + WebSockets) vs Railway vs Fly.io.
5. **Realtime:** Socket.IO (recommended, already installed) vs Supabase Realtime.
6. **Payment timing:** authorize at booking, capture on completion (recommended) vs charge at completion only.

## 9. Risks
- Google Maps: Distance Matrix requires billing + a **server** key; current key is browser-exposed and likely referrer-restricted. May need a second key.
- Next.js 16 differences → consult local docs before each page/route change.
- Socket.IO on serverless hosts is unreliable; use a persistent Node host for backend.
- Stripe Connect payouts multiply scope; ledger keeps Day 8 achievable.
- Supabase schema changes are live — migrations must be applied in a staging project first if data matters.
