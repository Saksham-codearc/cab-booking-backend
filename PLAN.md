# RideFlow — Days 4–14 Implementation Plan

> Status: **PLANNING ONLY — no code changes made yet.**
> Scope: everything from Day 4 (Maps & Ride Requests) through Day 14 (Deployment & Launch).
>
> **Confirmed decisions:** self-serve driver onboarding · **Razorpay** (authorize at booking, capture on completion) · **Nodemailer + Gmail SMTP** receipts · **Render** backend · **Supabase Realtime** for live updates.

---

## 1. Current State (verified in repo)

### Backend (`backend/`)
- Express 5 + TypeScript (`NodeNext`, `.js` import suffixes, CommonJS package).
- Clerk auth (`@clerk/express`) + Supabase via **service-role** key.
- Installed but currently unused: `zod`, `express-rate-limit`, `socket.io` (socket.io will be
  removed — Supabase Realtime replaces it).
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
        Express API (Render)
        ├── Zod validation + rate limits + role guards
        ├── Supabase Postgres (service role)
        ├── Google Maps (Places proxy, Distance/Directions)
        ├── Razorpay (Orders + manual capture + webhook)
        └── Nodemailer (SMTP receipts)
                     │
                     ▼
              Supabase Postgres
                     │ Realtime (Postgres Changes over RLS)
                     ▼
             Rider / Driver UI
```

Live updates use **Supabase Realtime**, so the backend can run on Render's free tier
(no long-lived WebSocket server required).

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
- **`payments`** — ride_id, provider (`razorpay`), razorpay_order_id, razorpay_payment_id, razorpay_signature, amount, currency, status (`created→authorized→captured|failed|refunded`), method, platform_fee, driver_earnings, captured_at, receipt_url.
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
│  ├─ payments.ts           # Razorpay orders/captures
│  └─ email.ts              # Nodemailer SMTP receipts
└─ tests/                   # vitest + supertest
```

(No WebSocket server: live updates flow from Postgres → Supabase Realtime → frontend.)

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
**Goal:** live status updates without refresh, using **Supabase Realtime**.

Database / Supabase
- Enable Realtime replication for `rides`, `notifications`, `ride_status_events`.
- Enable **RLS** on all tables (backend service-role bypasses it) with owner-scoped policies:
  - riders select/update their own `rides`; drivers select rides assigned to them;
  - users select/update their own `notifications`;
  - drivers select only the limited fields of `requested` rides via a safe `available_rides`
    view/table so unaccepted requests can surface live;
  - reviews readable by everyone (public driver profiles).
- Frontend uses `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` (never the service key).

Backend
- `notifications` table + `GET /api/notifications`, `PATCH /api/notifications/:id/read`.
- Insert notification rows on request/accept/arrive/start/complete/cancel.
- `ride_status_events` written on every transition (timeline + audit).

Frontend
- `useRealtimeRide(rideId)` subscription on `rides` Postgres Changes (rider-owned /
  driver-assigned). Driver dashboard also subscribes to live `requested` rides.
- `useNotifications(profileId)` subscription on own `notifications`.
- Toast on new notification; bell with unread count, persisted across refresh.
- Rider live ride page `/rides/[id]`: map + status timeline + driver card.
- Fallback: refetch on reconnect and polling every 15s if the socket is disconnected.

Acceptance
- Accepting in the driver tab updates rider UI within ~1–2s; notifications persist across refresh;
  unauthorized users see no rows (RLS verified).

### Day 7 — Buffer & Testing
- `vitest` + `supertest` setup.
- Unit tests: fare calculation (per type, rounding, min fare), haversine, status state machine, matching filter.
- Route tests: auth rejection, validation errors (400), role guards (403), double-accept (409) — Supabase and Clerk mocked.
- Manual smoke script: sign-up → sync profile → book → accept → complete.
- Fix defects surfaced here.

### Day 8 — Razorpay Payments
- `razorpay` Node SDK; test-mode key id/secret.
- Flow: at booking create a Razorpay **Order** with `payment_capture: 0` (manual capture),
  then open Razorpay Checkout for the rider → payment is **authorized** (funds held, up to 5 days).
- On ride `complete`: server verifies the checkout signature (HMAC SHA256), then captures the
  payment for the final fare via `payments.capture(payment_id, amount)`; write the `payments` row.
- On cancellation: leave the authorization uncaptured (Razorpay auto-voids it at the end of the
  5-day auth window); if already captured, issue `payments.refund`.
- Webhook `/api/payments/webhook` with **raw body + `X-Razorpay-Signature` verification**
  reconciles `payment.authorized`, `payment.captured`, `payment.failed`, `refund.processed`; idempotent by payment id.
- Driver share = fare − platform fee (default 20%), credited to `driver_earnings`
  (internal ledger; Razorpay Route/Connect-style payouts are future work).
- Frontend: Razorpay Checkout script (loaded lazily), pay step after ride request,
  payment status on the ride/receipt. INR only.

Acceptance
- Test payment authorizes at booking, captures on completion, failed/declined payments handled,
  cancellation voids the hold, webhook replay is idempotent.

### Day 9 — Ride History & Receipts
- `GET /api/rides/history?role=rider|driver&page=…` with pagination + filters (status/date).
- `GET /api/rides/:id/receipt` (JSON/HTML) + **Nodemailer over Gmail SMTP** receipt email on completion
  (`SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`, `SMTP_USER`, `SMTP_PASS` = Gmail App Password).
- Receipt HTML template (fare breakdown, distance, driver, payment id) + optional PDF attachment.
- Frontend `/rides/history` (rider & driver tabs), receipt view, "email receipt" action,
  driver earnings summary.

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
- Helmet tuned for Google Maps/Razorpay; **Razorpay webhook HMAC signature + checkout signature verification**; input length caps.
- **RLS audit** on every Supabase table (anon key is public); verify riders/drivers cannot read others' rows.
- DB indexes above; `select` only needed columns; nearby-driver query via indexed RPC; pagination everywhere.
- Frontend: lazy-load map/Razorpay/Realtime, dynamic import, image/font hygiene, bundle check.
- Env audit: service-role key and Razorpay secret only backend; Maps server key restricted; `.env*` git-ignored.

### Day 13 — Final Testing & Bug Fixes
- Full-flow E2E (Clerk test user, rider + driver): sign-up → sync → driver online → book → accept → arrive → start → pay → complete → review → receipt.
- Negative tests: cancelled rides, expired auth, double booking, payment failure, unauthorized access.
- Cross-browser/mobile viewport pass; console/network error sweep; fix all blockers.

### Day 14 — Deployment & Launch
- Frontend → Vercel (`frontend/` root): env `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `NEXT_PUBLIC_API_URL`,
  `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `NEXT_PUBLIC_RAZORPAY_KEY_ID`.
- Backend → **Render** (Web Service): build `npm install && npm run build`, start `npm start`,
  health check `/api/health`, secrets set in dashboard (Supabase Realtime removes the need for
  a persistent WebSocket server, so Render free/shared tier is fine).
- Clerk production keys + allowed origins; Supabase migrations + RLS applied; Razorpay
  webhook URL registered (`https://<backend>.onrender.com/api/payments/webhook`).
- README: setup, env table, API reference, demo script, architecture diagram.
- Final demo + smoke test on production URLs.

---

## 6. New Environment Variables

Backend: `GOOGLE_MAPS_SERVER_KEY`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`,
`RAZORPAY_WEBHOOK_SECRET`, `PLATFORM_FEE_PERCENT`, `FRONTEND_URL` (CORS),
`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `RECEIPT_FROM_EMAIL`,
optional `DRIVER_SEARCH_RADIUS_KM`.
Frontend: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_RAZORPAY_KEY_ID`.

New packages: backend `razorpay`, `nodemailer` (+ `@types/nodemailer`), `vitest`, `supertest`
(+ `@types/supertest`); frontend `@supabase/supabase-js`. Remove unused `socket.io`.

---

## 7. Ordered Execution & Checkpoints

| Stage | Includes | Checkpoint |
|---|---|---|
| A. Foundation | env validation, route split, migrations, auth middleware | server builds, existing endpoints still work |
| B. Day 4 | maps estimate, places UI, fare service | booking with coords + fare |
| C. Day 5 | drivers, matching, status machine, driver UI | end-to-end accept/complete |
| D. Day 6 | Supabase Realtime + RLS + notifications | live updates <2s |
| E. Day 7 | tests | `npm test` green |
| F. Day 8–10 | Razorpay, history/receipts, reviews | paid ride + receipt + rating |
| G. Day 11–12 | UI polish, security/perf | responsive pass, audit checklist |
| H. Day 13–14 | E2E, deploy | production demo |

Each stage ends with: build, lint, tests, manual smoke, short changelog note.

---

## 8. Confirmed Decisions

| Decision | Choice |
|---|---|
| Driver onboarding | Self-serve "Become a driver" toggle (+ `is_verified` flag for later review) |
| Payments | **Razorpay**, INR, order at booking with manual capture |
| Payment timing | Authorize at booking → **capture on completion** (5-day auth window) |
| Receipts email | **Nodemailer + Gmail SMTP** (App Password) |
| Backend hosting | **Render** |
| Realtime | **Supabase Realtime** (Postgres Changes + RLS) |

## 9. Risks
- Google Maps: Distance Matrix requires billing + a **server** key; current key is browser-exposed and likely referrer-restricted. May need a second key.
- Next.js 16 differences → consult local docs before each page/route change.
- **Razorpay:** manual capture must happen within **5 days** of authorization; checkout needs HTTPS in production; webhook secret and raw body required. Route/Connect-style automatic driver payouts are out of scope (internal ledger only).
- **Gmail SMTP:** requires 2FA + App Password; ~500 emails/day limit; fine for demo, replace with a transactional provider later.
- **Supabase Realtime:** frontend needs the anon key and RLS must be correct — a permissive policy leaks rides. Realtime only delivers rows the user can `select` under RLS.
- Supabase schema changes are live — apply migrations in a staging project first if data matters.
