# Activity Analytics Dashboard

React + TypeScript + Vite admin dashboard. Current state: project
scaffolding plus one real view — the device list — proving the full
fetch-to-render pipeline (typed API client, loading/error states, live
polling) before the rest of the dashboard gets built on top of it. See
[DESIGN.md](../DESIGN.md) for the full API contract.

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

## What's here

- `src/api.ts` — typed client wrapping `fetch` against the backend's
  admin-facing API, carrying `Authorization: Bearer <VITE_ADMIN_API_KEY>`
  on every request.
- `src/components/DeviceList.tsx` — fetches `GET /api/v1/devices`, renders
  the table, and re-polls every 15s so status changes (a device going
  idle/offline, a pause toggling) show up live, without a manual reload.
  Handles three states explicitly: loading, hard error (nothing has ever
  loaded), and soft error (a later poll failed but the last known data
  stays on screen with a visible "failed to refresh" banner rather than
  being blanked).
- `src/components/StatusBadge.tsx` — the status indicator. Colors follow
  the dataviz skill's fixed status palette: `active` → good (green),
  `idle` → warning (amber), `offline` → critical (red). `paused` isn't a
  severity state (it's deliberate, user-initiated), so it doesn't belong
  on that ladder — it gets a neutral/muted dot instead of being force-fit
  into "serious". Color lives on a small dot, not the status text itself,
  so meaning is never carried by color alone.
- `src/components/Layout.tsx` — header + nav shell. No router yet,
  deliberately — the nav is a static placeholder marking where Timeline,
  Stats, and Recent Activity slot in once they're built; only "Devices"
  does anything right now.
- `src/utils/relativeTime.ts` — hand-rolled "2 minutes ago" formatting, no
  date library dependency (matches the project's general preference for
  avoiding a dependency for something this small).

## Known limitation: the admin API key ships to the browser

`VITE_*` env vars are bundled into the client-side JavaScript — anyone
with dev tools open can read `VITE_ADMIN_API_KEY` directly out of the
bundle or the network tab. This is what was asked for (env-var-based
config, no backend-for-frontend proxy), and it's an acceptable tradeoff
for an internal/take-home admin tool, but it's a real one: a production
version would need session-based auth or a proxy layer that keeps the key
server-side, not a statically-embedded key in a public SPA bundle. See
DESIGN.md's known limitations.

## Verifying it

With the backend running and reachable, `npm run dev` and open
`http://localhost:5173`:
- The device table should populate with real data within a second or two.
- Stop the backend and reload — should show a clear "Failed to load
  devices" message, not a blank page.
- With the page already loaded, stop the backend — within 15s the table
  should show a "Failed to refresh" banner while the last-known rows stay
  visible (not blanked).
- Change a device's status via the API (e.g. `POST /events` with a
  different `agent_status`) without touching the page at all — within 15s
  the table should update on its own.

This was verified against a live backend with Playwright driving a real
headless Chromium (not just `tsc`/build success) — including the CORS
issue that surfaced only from an actual browser request (see DESIGN.md;
the backend now has `cors()` enabled for this reason).

## What's deliberately not here yet

Routing (only one real view exists), the other three views (timeline,
stats, recent activity), any styling framework beyond plain CSS custom
properties, and any state management beyond `useState`/`useEffect` (not
needed yet at this scale).
