# Activity Analytics Platform

A mini ActivTrak-like activity analytics platform: a desktop agent, a
Node.js/TypeScript backend, and a React dashboard.

Full data model, API contract, key design decisions, and known limitations
are in **[DESIGN.md](DESIGN.md)** — that file is the canonical reference.
This README covers what the assignment specifically asks for plus how to
run what's built so far.

## Status

| Component | Status |
|---|---|
| Backend | Built: device registration, event ingestion, device list/detail, stats summary, top apps, recent activity. Not yet built: timeline, activity-over-time. |
| Desktop agent (Go) | Not yet built |
| Dashboard (React) | Not yet built |

## Agent stack: Go

The agent will be a visible, always-on Windows tray application. Go is the
right fit for that: it compiles to a small static binary with no runtime to
bundle (unlike Electron), has a low idle memory footprint appropriate for
something meant to sit in the background all day, and gives direct access
to the Win32 APIs needed for foreground-window and idle detection
(`GetForegroundWindow`, `GetWindowText`, `GetLastInputInfo`) without a
wrapper layer.

## Running the backend

Requires Docker and Node.js 20+.

```
docker compose up -d              # Postgres on :5432
cd backend
npm install
cp .env.example .env              # set ADMIN_API_KEY to a real random value
npx prisma migrate deploy
npm run dev                       # http://localhost:3000
```

Run the test suite (needs the Postgres container running):

```
cd backend
npm test
```
