# Design Doc — Activity Analytics Platform

Canonical reference for the data model, API contract, key decisions, and
known limitations of this project. This is the single source of truth —
if it ever disagrees with a chat transcript, this file (and the code) wins.

## Components

| Component | Stack | Status |
|---|---|---|
| Desktop agent | Go, Windows | Not yet built |
| Backend | Node.js + TypeScript, Express 5, Prisma, PostgreSQL | Built: register, events ingestion, device list/detail, device timeline, stats/summary, stats/top-apps, activity/recent |
| Dashboard | React + TypeScript | Not yet built |

**Why Go for the agent**: a lightweight, always-on native process that has
to sit in the system tray with a visible pause/stop control benefits from a
small static binary, low idle memory footprint, and direct OS API access
(`GetForegroundWindow`, `GetWindowText`, `GetLastInputInfo` on Windows) —
Go compiles to exactly that without a runtime to bundle, unlike Electron or
a managed-runtime alternative.

## Data model (PostgreSQL, via Prisma)

Core concept: **segments**, not raw per-tick samples. A segment is a
continuous period of either "active on app X with title Y" or "idle,"
bounded by start/end timestamps — one row per app switch, idle transition,
or forced flush (see [Timing constants](#timing-constants)), not one row
per second.

```prisma
model Device {
  id             String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  deviceName     String    @map("device_name")
  os             String
  userIdentifier String    @map("user_identifier")
  apiKeyHash     String    @map("api_key_hash")
  agentStatus    String    @default("running") @map("agent_status") // 'running' | 'paused'
  createdAt      DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  lastSeenAt     DateTime? @map("last_seen_at") @db.Timestamptz(6)
  segments       ActivitySegment[]
  @@map("devices")
}

enum SegmentType { active idle } // @@map("segment_type")

model ActivitySegment {
  id              BigInt      @id @default(autoincrement())
  deviceId        String      @map("device_id") @db.Uuid
  clientSegmentId String      @map("client_segment_id") @db.Uuid  // agent-generated, dedup key
  type            SegmentType
  appName         String?     @map("app_name")       // null when type = idle
  windowTitle     String?     @map("window_title")    // null when type = idle
  startedAt       DateTime    @map("started_at") @db.Timestamptz(6)
  endedAt         DateTime    @map("ended_at") @db.Timestamptz(6)
  durationSeconds Int         @map("duration_seconds")
  receivedAt      DateTime    @default(now()) @map("received_at") @db.Timestamptz(6)
  device          Device      @relation(fields: [deviceId], references: [id])
  @@unique([deviceId, clientSegmentId])
  @@index([deviceId, startedAt], map: "idx_segments_device_time")
  @@index([appName], map: "idx_segments_app")
  @@map("activity_segments")
}
```

No pre-aggregated rollup tables — aggregates are computed at query time.
Not a scale concern at take-home data volumes; see known limitations for
what this trades away.

## Timing constants

| Constant | Value | Purpose |
|---|---|---|
| `HEARTBEAT_INTERVAL_SECONDS` | 30 | Agent's tick cadence — pings/flushes on this cadence regardless of activity |
| `OFFLINE_THRESHOLD_SECONDS` | 90 | 3 missed heartbeats before a device is considered offline |
| `SEGMENT_MAX_DURATION_SECONDS` | 300 | An open segment (e.g. one app in focus for hours) is force-flushed every 5 minutes so the dashboard is never more than 5 minutes stale on "what's happening now" |

## Device status derivation

Implemented in `backend/src/lib/deviceStatus.ts` (`deriveDeviceStatus`),
computed on read, not stored. Branch order matters — evaluated top to
bottom, first match wins:

1. `last_seen_at` is `null` or older than `OFFLINE_THRESHOLD_SECONDS` → **offline**
2. else if `agent_status === 'paused'` → **paused**
3. else if the device's latest segment has `type === 'idle'` → **idle**
4. else → **active**

`paused` is checked before the latest-segment-type check deliberately: an
agent explicitly paused by its user should read as "paused," not "active,"
even if its last recorded segment was active — precedence, not just
presence, is the point of this ordering.

## API contract

All endpoints under `/api/v1`. Two auth schemes:
- **Device auth** (`requireDeviceAuth`): `Authorization: Bearer <device api_key>`, looked up via SHA-256 hash of the raw key against `devices.api_key_hash`. Deterministic (not salted/bcrypt) hashing is deliberate — device API keys are high-entropy random tokens, not user-chosen passwords, so there's no dictionary-attack risk, and a deterministic hash allows an indexed `WHERE api_key_hash = ?` lookup instead of a per-row scan.
- **Admin auth** (`requireAdminAuth`): `Authorization: Bearer <ADMIN_API_KEY>`, a single static env-configured key, compared with `crypto.timingSafeEqual`.

### Ingestion (device auth)

**`POST /devices/register`** — no auth (see known limitations).
Body: `{ device_name, os, user_identifier }` (all required, non-empty).
Generates a 32-byte random hex API key, stores only its hash.
Response `201`: `{ device_id, api_key }` — the raw key is shown exactly once.

**`POST /events`** — called every `HEARTBEAT_INTERVAL_SECONDS` tick; also
serves as the heartbeat (no separate `/heartbeat` endpoint — see
[decisions](#key-decisions)).
Body: `{ agent_status: 'running'|'paused', events: [...] }` — `events` is
`[]` on most ticks (nothing new to report).
Each event: `{ client_segment_id, type: 'active'|'idle', app_name?, window_title?, started_at, ended_at, duration_seconds }`.
`app_name`/`window_title` required when `type: 'active'`, must be
absent/null when `type: 'idle'`. Malformed events reject the **entire
batch** with `400` naming every failing `events[i].field` (all-or-nothing,
not partial-insert). `window_title` passes through `redactWindowTitle()`
(a truncate-to-512-chars stub today — see known limitations for the real
seam this leaves open) before insert.
Insert uses `createMany({ skipDuplicates: true })` against the
`(device_id, client_segment_id)` unique constraint — idempotent on retry,
first write wins on conflict. `devices.agent_status`/`last_seen_at` update
unconditionally in the same transaction, even when `events` is empty.
Response `202`: `{ accepted, duplicates }`.

### Dashboard (admin auth)

**`GET /devices`** — all devices: `{ id, device_name, os, user_identifier, last_seen_at, status }`, ordered by `last_seen_at` desc, nulls last. `status` for every device computed from one `DISTINCT ON` query (latest segment type per device), not N+1.

**`GET /devices/:id`** — same shape plus `created_at`. `404` for a nonexistent or malformed id.

**`GET /devices/:id/timeline?from&to`** — `[{ client_segment_id, type, app_name, window_title, started_at, ended_at, duration_seconds }]`, ordered by `started_at` **ascending** (chronological) — deliberately the opposite of `activity/recent`'s descending order, since a timeline reads left-to-right as a sequence of what happened, not as a most-recent-first feed. `404` for a nonexistent or malformed device id (same handling as `GET /devices/:id`). No `device_id` field in the response — already scoped by the URL param. No limit/pagination this pass (see known limitations).

**`GET /stats/summary?from&to`** — `{ active_device_count, total_active_seconds, total_idle_seconds }`. `from`/`to` optional ISO timestamps filtering `started_at`; omitted = all-time. `active_device_count` is devices with derived status `!== 'offline'` **right now** — explicitly not "devices with segments in [from, to]." These are different questions ("who's online" vs. "who was active in this window"); the date range only scopes the two duration sums.

**`GET /stats/top-apps?from&to&device_id?`** — `[{ app_name, total_seconds }]`, top 20, descending. Excludes idle segments (`app_name` is always null there).

**`GET /stats/activity-over-time?from&to&bucket=hour|day&device_id?`** — *not yet built.*

**`GET /activity/recent?limit`** — `[{ device_name, type, app_name, window_title, started_at, ended_at, duration_seconds }]`, ordered by `started_at` desc. No `device_id` filter — not in the locked contract for this endpoint (unlike `top-apps`), not added speculatively. `limit` defaults to 50, clamped (not rejected) at 200 if higher; rejected with `400` if not a positive integer.

## Key decisions

- **Express 5, not Express 4 + a shim** — native forwarding of thrown/rejected errors from async handlers to error-handling middleware, matching "routes throw instead of nesting try/catch" without an `express-async-errors` patch dependency.
- **One ingestion endpoint, not `/events` + `/heartbeat`** — both would share the same auth check and the same `last_seen_at`/`agent_status` update; the payload-size difference between an empty `events` array and 0–2 segments is negligible. A second endpoint would only duplicate the same code path.
- **`client_segment_id` idempotency over at-least-once semantics** — the agent generates this UUID when a segment starts; the unique constraint plus `skipDuplicates` means retried batches after a dropped response are always safe to resend.
- **N+1 avoidance via `DISTINCT ON`** — Prisma's query builder has no "latest related row per parent" primitive (no window-function support in the fluent API); a single raw `SELECT DISTINCT ON (device_id) ... ORDER BY device_id, started_at DESC` gets every device's latest segment type in one round trip, backed by the existing `(device_id, started_at)` index. Shared via `lib/deviceStatus.ts`'s `getLatestSegmentTypeByDevice()`.

## Known limitations

Deliberately not fixed now — documented so they're a decision, not an oversight.

1. **Device registration is unauthenticated.** Anything that can reach the backend can register a device and get an API key. A real deployment would gate this behind an install-time secret or admin approval step.
2. **No dedup by `device_name` on `/register`.** Every call creates a new device row, even with a name matching an existing one.
3. **Force-flushed segments generate a steady row count for long single-app sessions.** At `SEGMENT_MAX_DURATION_SECONDS = 300`, one continuous 8-hour session produces ~96 rows instead of 1. A real deployment at scale would want periodic compaction/rollup of same-app adjacent segments, not a longer flush interval (which would trade away dashboard freshness instead). `GET /devices/:id/timeline` has no limit/pagination for the same reason this matters: it returns a device's *entire* segment history in one response, which is fine at take-home data volumes but would grow unbounded over a long retention period at the same rate this row-growth limitation describes — the fix is the same one (compaction/rollup), not pagination bolted onto an ever-growing raw table.
4. **The agent's local retry queue has no documented cap.** If the backend is unreachable for an extended period, unsent segments accumulate in memory with no size/age limit or disk persistence.
5. **`redactWindowTitle()` is a truncate-only stub.** It's the documented seam for real redaction (e.g. always blanking titles for known password managers) — not implemented, since window titles are logged in full per the assignment's explicit ask, with this as the acknowledged privacy tradeoff.
6. **Test suite isolation is serialized (`fileParallelism: false`), not transactional.** The Vitest suite hits one shared, mutable Postgres database with no per-test rollback. A concrete bug this caused and fixed: `stats/summary`'s `active_device_count` test raced against a concurrently-running file's device heartbeat before this flag was added. Serializing file execution removes the *timing* race but not the underlying shared-mutable-state design — it doesn't protect against a crashed test skipping its cleanup and leaving dirty state for the next one. The more correct fix, per-test transaction rollback, would require routing the app's Prisma singleton (`db.ts`) through an ambient per-test transaction (a real refactor — `routes/events.ts` already opens its own nested `$transaction`, which would need savepoint handling), which is more surgery than this assignment's scope warrants right now.

Separately, unresolved and not a design decision: `npm audit` flags 5
vulnerabilities (1 critical, 1 high, 3 moderate) in `vitest`'s transitive
`esbuild`/`vite` dev-server dependency (GHSA-67mh-4wv8-2f99). Only exploitable
if `vite`'s dev server is running and network-reachable, which nothing here
does (`vitest run` only, never a long-running dev server). Fixing it means
`vitest@4`, a breaking change not made unprompted.
