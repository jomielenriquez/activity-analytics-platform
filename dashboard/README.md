# Activity Analytics Dashboard

React + TypeScript + Vite admin dashboard. **All four views are built**:
Devices, per-device Timeline, Stats (with a chart), and Recent Activity,
with client-side routing between them. See [DESIGN.md](../DESIGN.md) for
the full API contract.

## Setup

Requires Node.js 20+, and the backend running (see the
[root README](../README.md)).

```
cd dashboard
npm install
cp .env.example .env    # fill in VITE_ADMIN_API_KEY with the backend's real ADMIN_API_KEY
npm run dev             # http://localhost:5173
```

`VITE_BACKEND_URL` and `VITE_ADMIN_API_KEY` are both required — `src/api.ts`
fails fast with a clear error at load time if either is missing, rather
than surfacing as a mysterious failed fetch.

## Routes

| Route | View |
|---|---|
| `/` | Devices — table, 15s live poll, click a row for its timeline |
| `/devices/:id/timeline` | Per-device segment history, `from`/`to` filters |
| `/stats` | Summary tiles, activity-over-time chart, top apps |
| `/activity/recent` | Reverse-chronological feed across all devices |

No standalone `/timeline` nav link — the route is inherently per-device
(`/devices/:id/timeline`), reachable by clicking a device row, so there's
no sensible destination for a generic "Timeline" nav item. The nav has
Devices/Stats/Recent Activity only.

## What's here

- `src/api.ts` — typed client wrapping `fetch` against every endpoint this
  dashboard uses, carrying `Authorization: Bearer <VITE_ADMIN_API_KEY>` on
  every request. `ApiError` carries the HTTP status code so callers can
  branch on it (the Timeline view checks `error.status === 404`) instead of
  parsing a message string.
- `src/hooks/useApiData.ts` — the shared loading/error/(optional poll)
  pattern every view uses: initial fetch shows a loading state; a failure
  with no prior data is a hard error; a *later* failure (a poll tick, or a
  refetch triggered by a filter/toggle changing) keeps existing data on
  screen with a soft "failed to refresh" banner instead of blanking the
  view. `error` is kept as the raw thrown value, not pre-stringified, so
  callers can inspect its type.
- `src/pages/` — one file per route (`DevicesPage`, `TimelinePage`,
  `StatsPage`, `RecentActivityPage`).
- `src/components/StatusBadge.tsx` — device status indicator (see below).
- `src/components/ActivityChart.tsx` — the activity-over-time chart (see
  below).
- `src/components/Layout.tsx` — header + real router nav (`NavLink`).
- `src/utils/relativeTime.ts`, `src/utils/formatDuration.ts` — hand-rolled
  "2 minutes ago" / "1.5h" formatting, no date library dependency (matches
  the project's general preference for avoiding a dependency for something
  this small).

## Status colors (Devices table)

Follow the dataviz skill's fixed status palette: `active` → good (green),
`idle` → warning (amber), `offline` → critical (red). `paused` isn't a
severity state (it's deliberate, user-initiated), so it doesn't belong on
that ladder — neutral/muted dot instead of being force-fit into "serious".
Color lives on a small dot, not the status text itself, so meaning is
never carried by color alone.

## The activity-over-time chart

Hand-rolled SVG, not a charting library (recharts, etc.) — the brief
offered both as reasonable and asked for the reasoning either way. This
project has consistently avoided a dependency for problems tractable by
hand; the dataviz skill's mark specs (bar caps, stacking gaps, gridlines,
legend rules) were enough to build a correct stacked bar chart without
needing a library's defaults, and it's still meaningfully more code than
this project's other hand-rolled bits (UUID generation, relative-time
formatting) — a real tradeoff, not a free win.

**Bars, not a line, and that choice is load-bearing, not just aesthetic**:
the backend never zero-fills missing buckets (DESIGN.md known limitation
#8). A line chart's connecting stroke would visually claim continuity
across a gap that isn't there; a bar chart just omits the bar for a
missing bucket, which is honest about what the data actually says.

**Two series** (active/idle), stacked per bucket (they're parts of one
whole — total tracked time in that bucket — not independent measures to
compare side by side), colored with the categorical palette (blue/orange),
deliberately *not* the status palette used for device status — same words,
different job: status means "this one entity's current state," categorical
means "identity of a series being compared."

**Simplified relative to the skill's full interaction spec**, given the
brief's "basic is enough": native SVG `<title>` tooltips on hover/focus
instead of a custom crosshair+tooltip layer. Every value is still visible
without hovering, via the axis labels and the stat tiles/top-apps table
elsewhere on the page.

## Recent Activity: manual refresh, not the Devices view's 15s poll

Deliberately different pattern from Devices, and why: Devices directly
answers "who's online right now," where staleness actively matters enough
to poll continuously. Recent Activity is more of a historical feed — up to
200 rows — where a poll silently re-sorting the list out from under
someone mid-read is more disruptive than useful, some staleness is fine,
and a button means the request only fires when someone's actually looking
at this view, not indefinitely in the background.

## Verifying it

With the backend running and reachable, `npm run dev` and open
`http://localhost:5173`. Beyond the basic "does data load" check:
- Click a device row → lands on its `/devices/:id/timeline`, segments in
  chronological (ascending) order.
- Navigate to `/devices/<made-up-uuid>/timeline` directly → clear "device
  not found" message, not a generic error or a crash.
- A device with no segments yet → "no activity recorded" message, not a
  blank list.
- On Stats, toggle Hour/Day → chart refetches and re-renders; a range with
  no data at all → explicit "no activity" message, not a broken empty
  chart.
- On Recent Activity, click Refresh → list updates; no auto-poll running
  in the background (confirm no repeated network requests without
  clicking).
- Kill the backend after a page has already loaded data → the soft-error
  pattern (banner + stale data retained) on Devices' next poll.

This was verified against a live backend with Playwright driving a real
headless Chromium for every route above (not just `tsc`/build success),
including clicking through from the Devices table into a real Timeline,
toggling the chart's bucket size, and the explicit 404 case.

## Known limitation: the admin API key ships to the browser

`VITE_*` env vars are bundled into the client-side JavaScript — anyone
with dev tools open can read `VITE_ADMIN_API_KEY` directly out of the
bundle or the network tab. This is what was asked for (env-var-based
config, no backend-for-frontend proxy), and it's an acceptable tradeoff
for an internal/take-home admin tool, but it's a real one: a production
version would need session-based auth or a proxy layer that keeps the key
server-side, not a statically-embedded key in a public SPA bundle. See
DESIGN.md's known limitations.

## What's deliberately not here yet

Any styling framework beyond plain CSS custom properties, any state
management beyond `useState`/`useEffect`/URL params (not needed yet at
this scale), and any automated test suite for the frontend (verification
so far has been live/manual via Playwright, not a committed test file —
worth adding if this dashboard keeps growing).
