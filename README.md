# Activity Analytics Platform

A mini ActivTrak-like activity analytics platform for tracking device
activity across an organization: a visible, always-on desktop agent reports
foreground-app and idle/active state to a backend, which a web dashboard
queries to show admins who's online, what they're using, and how their time
breaks down. Three components — a Go desktop agent, a Node.js/TypeScript
backend, and a React dashboard — **all three are now complete** per the
assignment's required scope.

## Architecture

- **Agent** (Go, Windows) — **complete**: tray shell, foreground-app/idle
  detection, segment construction, batching, and posting to the backend,
  verified end-to-end against a live backend and Postgres; see
  [agent/README.md](agent/README.md). Chosen for a small static binary and
  low idle memory footprint suited to something that sits in the tray all
  day, plus direct Win32 API access for foreground-window and idle
  detection without a wrapper runtime.
- **Backend** (Node.js + TypeScript, Express 5, Prisma, PostgreSQL) —
  **complete**: receives activity data from the agent and serves it to the
  dashboard, all 8 contract endpoints built and tested.
- **Dashboard** (React + TypeScript, Vite) — **complete**: all four views
  (Devices, per-device Timeline, Stats with a chart, Recent Activity) with
  client-side routing, verified against a live backend in a real browser;
  see [dashboard/README.md](dashboard/README.md).

Full data model, API contract, and the reasoning behind each design
decision live in **[DESIGN.md](DESIGN.md)** — that's the canonical
reference; this file won't duplicate it.

## Note on build order

The assignment specifies building in this order: desktop agent → backend
API → dashboard, with the agent called out as the most important
component. My actual order was different: I locked down the full data
model and API contract first (the agent and dashboard both depend on that
contract, so I wanted it stable before building against it), then fully
built and tested the backend, then the agent, then the dashboard.

In retrospect, given the assignment's explicit emphasis on the agent, I
should have scaffolded at least a minimal agent shell alongside the initial
contract design, rather than completing the backend first. The agent
itself wasn't shortchanged on attention or quality once I got to it — it
has real Win32 foreground/idle detection, segment construction with
idempotent batching, and full end-to-end verification against a live
backend (see [agent/README.md](agent/README.md) and AI_USAGE.md) — but the
sequencing itself didn't match what was asked, and I'd fix that if I did
this again.

## What I'd improve with more time

- **Build order** (see above) — start with the agent, even a minimal
  version, before the backend contract is fully implemented.
- **Test isolation**: the backend test suite currently serializes file
  execution (`fileParallelism: false`) because all tests share one mutable
  Postgres database. The correct fix is per-test transactional rollback,
  which would need the app's Prisma client threaded through an ambient
  test transaction rather than used as a module-level singleton — a real
  refactor, out of scope given the time available. Full tradeoff analysis
  in [DESIGN.md](DESIGN.md#known-limitations).
- **Window title redaction**: currently a truncate-only stub
  (`redactWindowTitle()`). Real redaction (blanking titles for known
  password managers, stripping query strings from browser tabs) has a
  documented seam to plug into but isn't implemented.
- **Agent retry queue durability**: unsent segments queue in memory with
  no size/age cap and no disk persistence — an extended backend outage
  would lose data silently past whatever memory allows.
- **Proportional segment splitting** in `activity-over-time`: a segment
  spanning a bucket boundary is currently attributed entirely to its start
  bucket rather than split proportionally across both.
- **Chrome extension**: not built. It's explicitly optional in the
  assignment, and I prioritized depth on the three required components
  (agent, backend, dashboard) over adding a fourth optional one given the
  time available.

Full list of known limitations, each a deliberate and documented tradeoff
rather than an oversight, is in [DESIGN.md](DESIGN.md#known-limitations).

## Setup

Requires Docker and Node.js 20+.

```
docker compose up -d              # Postgres on :5432

cd backend
npm install
cp .env.example .env              # set ADMIN_API_KEY to a real random value
npx prisma migrate deploy
npm run dev                       # http://localhost:3000
```

Run the backend test suite (needs the Postgres container running):

```
cd backend
npm test
```

Dashboard (needs the backend running):

```
cd dashboard
npm install
cp .env.example .env              # fill in VITE_ADMIN_API_KEY with the backend's real ADMIN_API_KEY
npm run dev                       # http://localhost:5173
```

## Completed so far

**Everything in the assignment's required scope is built.**

Backend — all 8 contract endpoints. Ingestion (device auth):

- `POST /api/v1/devices/register`
- `POST /api/v1/events`

Dashboard-facing (admin auth):

- `GET /api/v1/devices`
- `GET /api/v1/devices/:id`
- `GET /api/v1/devices/:id/timeline`
- `GET /api/v1/stats/summary`
- `GET /api/v1/stats/top-apps`
- `GET /api/v1/stats/activity-over-time`
- `GET /api/v1/activity/recent`

Agent — tray shell, foreground-app/idle detection, segment
construction/batching/posting to `POST /devices/register` + `POST /events`,
all verified end-to-end. See [agent/README.md](agent/README.md) for
build/run instructions.

Dashboard — all four views (Devices with 15s live polling, per-device
Timeline with date filters, Stats with a hand-rolled activity-over-time
chart and top-apps ranking, Recent Activity), client-side routed, every
loading/error/empty/404 state handled explicitly, verified against a live
backend with a real headless browser (not just a successful build). See
[dashboard/README.md](dashboard/README.md).

## Known limitations

See **[DESIGN.md](DESIGN.md#known-limitations)** for the full list (12
items) and the reasoning behind each — device registration is
unauthenticated, no dedup on device registration, force-flushed segments'
row growth, the agent's uncapped and non-durable retry queue, the
window-title redaction stub, the test suite's isolation model, two
`activity-over-time` simplifications (no proportional splitting of
segments across bucket boundaries, no zero-filling of empty buckets), the
agent's placeholder window title for windows that legitimately report an
empty one, the dashboard shipping the admin API key to the browser (a
`VITE_*` env var is bundled into client-side JS by design), the Stats
chart's day buckets rendering in local time against UTC-truncated backend
buckets, and no automated dashboard test suite — plus an open `npm audit`
item in `vitest`'s dev dependencies.
