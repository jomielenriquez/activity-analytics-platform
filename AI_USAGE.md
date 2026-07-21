# AI Usage Log

Tool: Claude Code (Sonnet 5), VSCode extension, plan mode.
This file is appended to at the end of each work session per the project
rule in CLAUDE.md. Prompts are logged as actually written, unedited.

---

## Session 1 — 2026-07-21

### Prompt 1 (user, verbatim)

> I'm building a mini ActivTrak-like activity analytics platform for a take-home assignment: a desktop agent (Go), a Node.js/TypeScript backend, and a React/TypeScript dashboard. Before writing any code, I want to nail down the data model and API shape. Here's the scope:
> Required scope
> 1. Desktop agent
> Build a visible local agent for macOS or Windows. It does not have to support both platforms.
> The agent may be written in any reasonable stack (Go, C#, Rust, etc.). Choose the one you
> think is best suited to a lightweight, always-on native agent, and briefly say why in your
> README.
> The agent should collect lightweight activity data such as the current foreground application, the
> window title where available, active vs idle state, timestamps and durations, a device or user
> identifier, and a heartbeat / last-seen signal. It should send this data to your backend.
> The agent must be visible and easy to stop or pause. Do not build stealth monitoring.
> 2. Backend API
> Design and build a backend API that receives activity data from the agent and exposes data for
> the dashboard. You decide the API shape, event model, database schema, and aggregation
> approach. Build it in Node.js + TypeScript.
> 3. Dashboard
> Build a basic web dashboard, in React + TypeScript, that helps an admin understand activity -
> things like active users or devices, last seen per device, total active and idle time, top
> applications, recent activity, and activity over time. It does not need to be beautiful, but it should
> be usable and clear.
> Propose an activity event schema and the core API endpoints. Ask me clarifying questions if anything about scope or constraints is ambiguous.

### Response 1 (assistant)

Ran a read-only `ls -la` on the repo root and confirmed it was empty scaffolding
(`.gitignore`, `README.md`, `AI_USAGE.md`, `CLAUDE.md`, no code). Then, per the
user's own request to ask clarifying questions, asked four scoping questions
via the AskUserQuestion tool rather than guessing:

1. **Which OS should the desktop agent target?**
   Options offered: Windows (recommended — matches dev environment, win32) / macOS.
   → User chose: **Windows**
2. **Which database should the backend use?**
   Options offered: PostgreSQL (recommended) / SQLite.
   → User chose: **PostgreSQL**
3. **How should the API and dashboard handle auth?**
   Options offered: Simple API key (recommended) / No auth / Full login system.
   → User chose: **Simple API key**
4. **How should window titles be handled, given the agent must be visible/non-stealth?**
   Options offered: Log full window title (recommended) / Log app name only, omit titles.
   → User chose: **Log full window title**

Based on these answers, wrote a first draft plan (`i-m-building-a-mini-peppy-bunny.md`,
in the Claude Code plan directory, not part of this repo) proposing:
- Two Postgres tables: `devices` and `activity_segments` (segment-based model —
  continuous periods of "active on app X" or "idle", not per-tick sampling).
- An agent → backend event schema (`POST /devices/register`, `POST /events`
  with a batched-segments + `heartbeat_at` body).
- Six dashboard read endpoints (devices list/detail, timeline, summary stats,
  top apps, activity-over-time, recent activity).
- Stack choices: Go + Win32 APIs for the agent; Express + Prisma + Postgres
  for the backend; React + Vite for the dashboard.

Called `ExitPlanMode` to request approval of this draft.

**Correction 1 (user, verbatim):**

> A few gaps before I lock this in: (1) long-running segments never get flushed until a switch happens - add a max flush duration so dashboard data doesn't go stale; (2) no idempotency/dedupe on POST /events for retried batches; (3) heartbeat interval is referenced but never defined - pin it explicitly; (4) pause state should be visible to the backend, not just local, or the dashboard can't distinguish paused from dead; (5) window titles are sensitive - add a hook for truncation/redaction even if we don't fully implement it now. Registration having no auth is fine as a documented known limitation, not something to fix now.

### Response 2 (assistant)

Revised the plan to address all five points:
1. Added `SEGMENT_MAX_DURATION_SECONDS = 300` — an open segment is force-flushed
   every 5 minutes even without a transition, so a single long session can't
   go stale on the dashboard.
2. Added a `client_segment_id` (agent-generated UUID) column with a
   `UNIQUE (device_id, client_segment_id)` constraint on `activity_segments`,
   and specified `ON CONFLICT ... DO NOTHING` on insert so retried batches are
   safely idempotent.
3. Pinned explicit timing constants: `HEARTBEAT_INTERVAL_SECONDS = 30`,
   `OFFLINE_THRESHOLD_SECONDS = 90`.
4. Added an `agent_status` column (`running`/`paused`) on `devices`, updated
   on every heartbeat, and rewrote the device-status derivation logic to
   check offline → paused → idle → active in that order, so "paused by user"
   is distinguishable from "process is dead."
5. Documented a `redactWindowTitle(title, appName)` hook in the ingestion
   path — a pass-through/truncation no-op for this assignment, but the single
   documented seam for real redaction later.

Also added a "Known limitations" section explicitly noting unauthenticated
device registration as an accepted tradeoff, per the user's instruction not
to fix it now. Called `ExitPlanMode` again.

**Correction 2 (user, verbatim):**

> This looks solid - approving it as the contract to build from. Two things to note in the README as known tradeoffs rather than fix now: (1) force-flushed segments will generate a lot of rows for long single-app sessions, and (2) the local retry queue has no documented cap for extended offline periods. Also - justify or simplify the /events vs /heartbeat split, your call.

### Response 3 (assistant)

Chose to **simplify** rather than justify keeping two endpoints: merged
`POST /heartbeat` into `POST /events`, since both endpoints would have
shared the same auth check and the same `last_seen_at`/`agent_status`
update, and the payload-size difference between an empty `events` array and
0–2 segments is negligible — a second endpoint would only have duplicated
the same code path. Updated the event-schema section and the endpoint list
to reflect a single ingestion endpoint called every 30s tick.

Added two more entries to "Known limitations": row growth from force-flushed
segments on long single-app sessions (~96 rows per 8-hour session at the
5-minute flush interval), and the agent's local retry queue having no
documented size/age cap during extended backend outages.

Called `ExitPlanMode` a third time. **Approved by the user.**

### Response 4 (assistant, verbatim)

> The contract is locked in and saved to the plan file. Design summary:
>
> - **Schema**: `devices` + `activity_segments` tables in Postgres, with idempotent inserts via `client_segment_id` and a derived (not stored) status of active/idle/paused/offline.
> - **API**: `POST /devices/register` (one-time), `POST /events` (30s-cadence heartbeat + segment flush, doubles as liveness ping), and six `GET` endpoints for the dashboard (devices, device detail, timeline, summary stats, top apps, activity-over-time, recent activity).
> - **Constants pinned**: 30s heartbeat, 90s offline threshold, 300s max segment duration before force-flush.
> - Three known tradeoffs documented in the plan for the README rather than solved now (unauthenticated registration, row growth from force-flush, unbounded retry queue).
>
> Per the plan's next-steps order, implementation would start with `backend/` (Prisma schema + Express routes), then `agent/`, then `dashboard/`. Want me to start scaffolding the backend now, or do you want to sit with the contract a bit longer first?

### Prompt 2 (user)

Selected lines 91–113 of the plan file in the IDE (the "Agent → backend
event schema" section and the `/devices/register` + `/events` request/response
examples) and sent:

> update AI_USAGE.md

### Response 5 (assistant)

Wrote this log entry.

### Prompt 3 (user, verbatim)

> Yes, start with backend/. First just the Prisma schema matching the devices and activity_segments tables from the plan, plus the initial migration. Don't build routes yet — I want to check the schema against a running Postgres container first.

### Response 6 (assistant)

Checked for Docker (`docker --version` via both Git Bash and PowerShell, and a
filesystem check for a Docker Desktop install path) — not found on the
machine. Rather than assume how to proceed, asked the user via
AskUserQuestion:

- **Docker isn't installed on this machine, so I can't spin up the Postgres
  container myself. How do you want to handle verifying the schema?**
  Options offered: I'll install Docker myself / Use a local native Postgres
  install / Just scaffold files, don't run anything yet.
  → User chose: **I'll install Docker myself**

Scaffolded the backend without running a live migration:
- `docker-compose.yml` (repo root) — a single `postgres:16` service, port
  5432, credentials/db name `activity_analytics`.
- `backend/package.json` — `@prisma/client` + `prisma`/`typescript`/`@types/node`
  as the only dependencies; no Express yet since routes weren't in scope.
- `backend/tsconfig.json` — minimal strict config, `rootDir: src` (no `src/`
  yet, nothing to compile).
- `backend/prisma/schema.prisma` — `Device` and `ActivitySegment` models
  mapped to the plan's exact table/column names, including the
  `client_segment_id` unique constraint and the two named indexes
  (`idx_segments_device_time`, `idx_segments_app`). Used
  `@default(dbgenerated("gen_random_uuid()"))` on `Device.id` specifically to
  force the DB-level default to match the plan's SQL, rather than relying on
  Prisma's `uuid()` helper (which generates client-side).
- `backend/.env.example` — `DATABASE_URL` matching the compose service.
- Root `.gitignore` — was empty; added `node_modules/`, `dist/`, `build/`,
  `.env`, `.env.local`, `*.log`.

Ran `npm install` in `backend/`, copied `.env.example` to `.env` (gitignored,
local-only), and ran `npx prisma validate` and `npx prisma generate` — both
succeeded, confirming the schema is syntactically correct and the client
compiles, without needing a live DB connection. Explicitly did **not** run
`prisma migrate dev`, since that requires a live database to diff against and
the user wanted to run that step themselves once Docker was installed.
Reported the file list and gave the exact next commands
(`docker compose up -d`, then `npx prisma migrate dev --name init`).

### Prompt 4 (user)

Opened `backend/prisma/migrations/20260721063914_init/migration.sql` in the
IDE (the migration the user generated themselves by running
`npx prisma migrate dev --name init` against their own Postgres container
after installing Docker) and sent:

> update AI_USAGE.md

### Response 7 (assistant)

Read the generated migration SQL to confirm it matched the plan's schema —
it did, exactly: the `segment_type` enum, both tables with the plan's column
names/types, the two named indexes, the `client_segment_id` unique
constraint, and the FK from `activity_segments.device_id` to `devices.id`.
No corrections needed. Wrote this log entry.

---

**Outcome at end of session:** `backend/` is scaffolded with a Prisma schema
and an applied initial migration, verified by the user against a real
Postgres container they set up themselves (Docker was not installed at the
start of the session). No Express routes or application code yet — that
remains the next step, per the plan's build order (`backend/` → `agent/` →
`dashboard/`).
