# Activity Analytics Platform

A mini ActivTrak-like activity analytics platform for tracking device
activity across an organization: a visible, always-on desktop agent reports
foreground-app and idle/active state to a backend, which a web dashboard
queries to show admins who's online, what they're using, and how their time
breaks down. Three components — a Go desktop agent, a Node.js/TypeScript
backend, and a React dashboard — of which the backend is now complete.

## Architecture

- **Agent** (Go, Windows) — tray shell plus foreground-app/idle detection
  built (logs to console; no network calls yet); see
  [agent/README.md](agent/README.md). Chosen for a small static binary and
  low idle memory footprint suited to something that sits in the tray all
  day, plus direct Win32 API access for foreground-window and idle
  detection without a wrapper runtime.
- **Backend** (Node.js + TypeScript, Express 5, Prisma, PostgreSQL) —
  **complete**: receives activity data from the agent and serves it to the
  dashboard, all 8 contract endpoints built and tested.
- **Dashboard** (React + TypeScript, not yet built) — admin-facing view of
  device activity.

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

## Completed so far

Backend is fully complete — all 8 contract endpoints. Ingestion (device
auth):

- `POST /api/v1/devices/register`
- `POST /api/v1/events`

Dashboard (admin auth):

- `GET /api/v1/devices`
- `GET /api/v1/devices/:id`
- `GET /api/v1/devices/:id/timeline`
- `GET /api/v1/stats/summary`
- `GET /api/v1/stats/top-apps`
- `GET /api/v1/stats/activity-over-time`
- `GET /api/v1/activity/recent`

Agent: tray shell plus foreground-app/idle detection, logged to console
for manual verification — no network calls, no segment construction/
posting yet. See [agent/README.md](agent/README.md) for build/run
instructions. Not yet built: the React dashboard.

## Known limitations

See **[DESIGN.md](DESIGN.md#known-limitations)** for the full list and the
reasoning behind each — device registration is unauthenticated, no dedup
on device registration, force-flushed segments' row growth, the agent's
unbounded retry queue (once built), the window-title redaction stub, the
test suite's isolation model, and two `activity-over-time` simplifications
(no proportional splitting of segments across bucket boundaries, no
zero-filling of empty buckets), plus an open `npm audit` item in `vitest`'s
dev dependencies.

This section will expand as the agent and dashboard are built.
