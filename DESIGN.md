# Design Doc — Activity Analytics Platform

Canonical reference for the data model, API contract, key decisions, and
known limitations of this project. This is the single source of truth —
if it ever disagrees with a chat transcript, this file (and the code) wins.

## Components

| Component | Stack | Status |
|---|---|---|
| Desktop agent | Go, Windows | **Fully wired to the backend** — tray shell, foreground-app/idle detection, segment construction, batching, and posting to `POST /devices/register` + `POST /events`, verified end-to-end against a live backend and Postgres |
| Backend | Node.js + TypeScript, Express 5, Prisma, PostgreSQL | **Fully complete** — all 8 contract endpoints built and tested |
| Dashboard | React + TypeScript, Vite | Scaffolding + one real view (device list) proving the fetch-to-render pipeline: typed API client, loading/error states, 15s live polling, all verified against a live backend in a real browser. Other 3 views not yet built |

**Why Go for the agent**: a lightweight, always-on native process that has
to sit in the system tray with a visible pause/stop control benefits from a
small static binary, low idle memory footprint, and direct OS API access
(`GetForegroundWindow`, `GetWindowText`, `GetLastInputInfo` on Windows) —
Go compiles to exactly that without a runtime to bundle, unlike Electron or
a managed-runtime alternative.

**Why `fyne.io/systray` for the tray UI**: it's a thin cross-platform
wrapper directly over each OS's native tray API (Win32 Shell_NotifyIcon on
Windows) — no bundled browser/runtime (rules out an Electron-style tray,
which would contradict the whole reason for choosing Go in the first
place), and no CGo/C toolchain requirement on Windows specifically (some
Linux/macOS tray libraries need CGo bindings to GTK/Cocoa; systray's
Windows backend is pure Win32 syscalls), which keeps the build a plain
`go build` with no external C compiler dependency. The alternative of
hand-rolling `Shell_NotifyIcon` calls directly via
`golang.org/x/sys/windows` would remove the dependency entirely but adds
real boilerplate (window class registration, message loop, icon resource
handling) for a first pass that's explicitly meant to be minimal.

This project started on `getlantern/systray`, the original and
better-known of the two, then switched after a maintenance check:
`getlantern/systray` hadn't been pushed to since July 2024 (2 years stale)
with 114 open issues; `fyne.io/systray` — a fork maintained under the
actively-developed Fyne GUI toolkit project — had merged PRs as recently
as June 2026 and far fewer open issues (13) relative to its smaller but
real community. The two are near-drop-in-compatible (identical
`systray.Run`/`SetIcon`/`AddMenuItem`/`ClickedCh` API, differing only in
import path), so the switch was a two-line import change plus a
`go mod tidy` and cost nothing in `tray.go`'s actual logic — confirmed by
rebuilding and reconfirming `go vet ./...` clean, not just assumed. That
near-zero swap cost was itself part of the decision: it's cheap now, before
any tracking logic depends on it, and would only get more expensive to
reconsider later.

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

**`GET /stats/activity-over-time?from&to&bucket=hour|day&device_id?`** — `[{ bucket_start, active_seconds, idle_seconds }]`, ordered chronologically ascending. `bucket` is **required**, must be exactly `hour` or `day` (`400` otherwise). `device_id`, if provided, must be a valid UUID (`400` if not) but never `404`s for a well-formed id that matches no device — this is an aggregation endpoint, not a resource lookup, so a non-matching filter is just an empty result, same as `top-apps`. Buckets computed via raw SQL `date_trunc('hour'|'day', started_at)` grouped with `type` (same raw-SQL precedent as the `DISTINCT ON` query behind device status) — Prisma's query builder has no bucketing/`date_trunc` primitive. **Only buckets with at least one segment appear** — empty buckets are never zero-filled (see known limitations for why, and what it means for the dashboard). A segment is attributed **entirely** to the bucket containing its `started_at`, with no proportional splitting across a bucket boundary (see known limitations).

**`GET /activity/recent?limit`** — `[{ device_name, type, app_name, window_title, started_at, ended_at, duration_seconds }]`, ordered by `started_at` desc. No `device_id` filter — not in the locked contract for this endpoint (unlike `top-apps`), not added speculatively. `limit` defaults to 50, clamped (not rejected) at 200 if higher; rejected with `400` if not a positive integer.

## Key decisions

- **Express 5, not Express 4 + a shim** — native forwarding of thrown/rejected errors from async handlers to error-handling middleware, matching "routes throw instead of nesting try/catch" without an `express-async-errors` patch dependency.
- **One ingestion endpoint, not `/events` + `/heartbeat`** — both would share the same auth check and the same `last_seen_at`/`agent_status` update; the payload-size difference between an empty `events` array and 0–2 segments is negligible. A second endpoint would only duplicate the same code path.
- **`client_segment_id` idempotency over at-least-once semantics** — the agent generates this UUID when a segment starts; the unique constraint plus `skipDuplicates` means retried batches after a dropped response are always safe to resend.
- **N+1 avoidance via `DISTINCT ON`** — Prisma's query builder has no "latest related row per parent" primitive (no window-function support in the fluent API); a single raw `SELECT DISTINCT ON (device_id) ... ORDER BY device_id, started_at DESC` gets every device's latest segment type in one round trip, backed by the existing `(device_id, started_at)` index. Shared via `lib/deviceStatus.ts`'s `getLatestSegmentTypeByDevice()`.
- **CORS is open (all origins), not locked to the dashboard's origin** — found live when the dashboard's first real browser request was silently blocked by the browser before it reached auth at all (curl and the test suite never exercise this, since neither is a browser enforcing CORS). Permissive origin is an acceptable choice specifically because auth here is a `Bearer` token in a header, not a cookie: CORS's actual security value is restricting *credentialed* (cookie-based) cross-origin requests, which doesn't apply to header-based auth — the real access boundary is still `requireAdminAuth`/`requireDeviceAuth`, unaffected by which origin the request came from.

## Known limitations

Deliberately not fixed now — documented so they're a decision, not an oversight.

1. **Device registration is unauthenticated.** Anything that can reach the backend can register a device and get an API key. A real deployment would gate this behind an install-time secret or admin approval step.
2. **No dedup by `device_name` on `/register`.** Every call creates a new device row, even with a name matching an existing one.
3. **Force-flushed segments generate a steady row count for long single-app sessions.** At `SEGMENT_MAX_DURATION_SECONDS = 300`, one continuous 8-hour session produces ~96 rows instead of 1. A real deployment at scale would want periodic compaction/rollup of same-app adjacent segments, not a longer flush interval (which would trade away dashboard freshness instead). `GET /devices/:id/timeline` has no limit/pagination for the same reason this matters: it returns a device's *entire* segment history in one response, which is fine at take-home data volumes but would grow unbounded over a long retention period at the same rate this row-growth limitation describes — the fix is the same one (compaction/rollup), not pagination bolted onto an ever-growing raw table.
4. **The agent's local retry queue has no cap.** `SegmentQueue` (`agent/segment.go`) accumulates unsent segments in memory with no size/age limit when `POST /events` fails — verified live by stopping the backend mid-run and confirming segments correctly stayed queued and were accepted once it came back, but nothing bounds how long or how large that queue can grow if the backend stays down. It's also **not persisted**: an agent crash or manual restart while segments are queued loses them — there's no disk-backed queue, only in-memory. A real deployment would want both a cap (drop-oldest or spill-to-disk past some size) and durability across restarts.
5. **`redactWindowTitle()` is a truncate-only stub.** It's the documented seam for real redaction (e.g. always blanking titles for known password managers) — not implemented, since window titles are logged in full per the assignment's explicit ask, with this as the acknowledged privacy tradeoff.
6. **Test suite isolation is serialized (`fileParallelism: false`), not transactional.** The Vitest suite hits one shared, mutable Postgres database with no per-test rollback. A concrete bug this caused and fixed: `stats/summary`'s `active_device_count` test raced against a concurrently-running file's device heartbeat before this flag was added. Serializing file execution removes the *timing* race but not the underlying shared-mutable-state design — it doesn't protect against a crashed test skipping its cleanup and leaving dirty state for the next one. The more correct fix, per-test transaction rollback, would require routing the app's Prisma singleton (`db.ts`) through an ambient per-test transaction (a real refactor — `routes/events.ts` already opens its own nested `$transaction`, which would need savepoint handling), which is more surgery than this assignment's scope warrants right now.
7. **`activity-over-time` attributes a segment entirely to the bucket containing its `started_at`, with no proportional splitting across a bucket boundary.** A segment starting at 10:58 and ending at 11:03 counts fully in the 10:00 hour bucket, none of it in 11:00. A deliberate simplification: real splitting would mean re-deriving partial durations per bucket instead of trusting the stored `duration_seconds` directly, which is real complexity not warranted here — most segments are far shorter than a bucket width anyway (force-flush caps a single segment at 5 minutes, well under even the hour bucket).
8. **`activity-over-time` never zero-fills empty buckets.** A bucket only appears in the response if it has at least one segment. Backfilling would need a bucket sequence independent of the data — awkward when `from`/`to` are omitted (all-time has no natural start) — and would silently balloon the response for any sparse range (day-bucketed over a year with activity on 10 days would otherwise return 355 zero rows). This means the dashboard's chart needs to render **real gaps** on the x-axis for missing buckets, not assume a dense, continuous series.
9. **The agent substitutes `"(no window title)"` when a real active window has an empty title.** Found live during end-to-end testing, not anticipated in the original design: some real Win32 windows (observed: `OpenWith.exe`'s foreground window) legitimately report an empty title, but the backend requires a non-empty `window_title` for `type: "active"` (an empty string is rejected the same as a missing one). Dropping the segment entirely would lose real activity time; the placeholder keeps the segment while being honest that no real title was available, rather than fabricating one.
10. **The dashboard ships the admin API key to the browser.** `VITE_ADMIN_API_KEY` is bundled into client-side JavaScript by design (Vite env vars are meant to be public) — anyone with dev tools open can read it out of the bundle or any request's headers. Acceptable for an internal/take-home admin tool with no other auth model built, but a real deployment would need session-based auth or a backend-for-frontend proxy that keeps the key server-side, never shipped to a public SPA bundle.

Separately, unresolved and not a design decision: `npm audit` flags 5
vulnerabilities (1 critical, 1 high, 3 moderate) in `vitest`'s transitive
`esbuild`/`vite` dev-server dependency (GHSA-67mh-4wv8-2f99). Only exploitable
if `vite`'s dev server is running and network-reachable, which nothing here
does (`vitest run` only, never a long-running dev server). Fixing it means
`vitest@4`, a breaking change not made unprompted.
