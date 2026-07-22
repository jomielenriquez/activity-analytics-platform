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
