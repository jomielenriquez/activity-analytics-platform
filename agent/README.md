# Activity Analytics Agent

Windows system-tray agent. Current state: the tray shell (status label,
Pause/Resume toggle, Quit), foreground-app/idle-state detection, and now
segment construction + batching + posting to the backend — this is fully
wired end-to-end. See [DESIGN.md](../DESIGN.md) for the full contract.

## Build and run (Windows)

Requires Go 1.21+ (developed against 1.26.5), and the backend running
(see the [root README](../README.md)) — the agent registers itself and
posts to it on startup.

```
cd agent
go mod tidy
go build -o agent.exe .
.\agent.exe
```

This build is **console-subsystem** (no `-ldflags="-H=windowsgui"`)
deliberately, for now: the log output below is only useful if you can
actually see it, and a GUI-subsystem binary has no attached console to
print to. A console window will appear alongside the tray icon while this
is the case; `-ldflags="-H=windowsgui"` should come back for a quiet,
tray-only build once console output is no longer how this gets verified
(e.g. once there's a dashboard to check instead).

You should see a bright orange circular icon appear in the system tray
(may be in the hidden-icons overflow area — check there if it's not
immediately visible). Right-click (or left-click, depending on your
Windows version/taskbar settings) it for the menu: a "Status: Running"
label, "Pause" (which flips to "Resume" and back), and "Quit".

To stop it without the menu: `taskkill /IM agent.exe /F` from another
terminal, or Task Manager.

## Verifying foreground/idle detection

With the agent running, watch the console. Every `PollIntervalSeconds`
(3s), you should see a line like:

```
2026/07/21 21:50:44 [tracker] active | idle=4s | app=Code.exe | title="some window title"
```

To verify it's real, not static:
- **Switch between a few apps** (alt-tab, click different windows) and
  confirm `app=` and `title=` update to match within a few seconds.
- **Leave the mouse/keyboard alone** and watch `idle=` climb every poll;
  after `IdleThresholdSeconds` (5 minutes, in `config.go`) it should flip
  from `active` to `idle`. Move the mouse and it should drop back to
  `active` on the next poll.
- **Click Pause** in the tray menu and confirm the console prints
  `[tracker] paused — polling stopped` and then goes silent — no more
  poll lines at all, not just ones that stop reporting. **Click Resume**
  and confirm `[tracker] resumed — polling started` followed by polling
  picking back up.

## Verifying registration, segments, and posting

**First run** (no `device.json` present yet) should log something like:
```
[device] no stored credentials — registering as device_name=YOUR-PC user_identifier=YOUR-PC\you
[device] registered new device_id=..., saved to C:\...\agent\device.json
```
**Every run after that** should instead log `[device] loaded existing
credentials from ...` — confirms it's not silently re-registering a new
device every launch. Delete `device.json` to force a fresh registration.

**Switch apps a couple of times** and watch for:
```
[tracker] segment closed and queued: id=... type=active app="chrome.exe" duration=8s
```
— one of these per app switch or active/idle transition, per DESIGN.md's
segment model.

**Every `HeartbeatIntervalSeconds` (30s)**, regardless of whether anything
closed, you should see:
```
[sender] sending 2 segment(s), agent_status=running
[sender] batch sent: accepted=2 duplicates=0
```
(`sending 0 segment(s)` is normal and expected on most ticks — it's still
a real POST, since it's also the liveness ping.) Check the dashboard
`GET /api/v1/devices/:id/timeline` endpoint, or query Postgres directly,
to confirm segments actually landed — the accepted/duplicates counts alone
only prove the backend *responded*, not that the data is correct.

**Stop the backend** (or point `BackendURL` in `config.go` at a
nonexistent one) and confirm `[sender] send failed, N segment(s) remain
queued for next tick` — then restart the backend and confirm the same
segments go out and get accepted on a later tick, proving the queue
survives a failed send rather than dropping data.

## Swapping the placeholder icon

`assets/icon.ico` is a generated placeholder — a solid orange circle,
chosen to be impossible to miss in a tray full of gray monochrome icons.
To use a real one: replace `assets/icon.ico` with your own `.ico` file
(any size; Windows scales it) and rebuild. No code changes needed —
`tray.go` embeds whatever is at that path via `//go:embed`.

## Project layout

- `main.go` — entrypoint; wires up `AgentState` and hands control to
  `systray.Run`.
- `tray.go` — all tray/menu code (icon, menu items, click handlers). The
  only file that imports `fyne.io/systray`.
- `state.go` — `AgentState`: the Running/Paused state and its toggle,
  guarded by a mutex. This is the seam between the tray and the tracker:
  `tracker.go` reads `state.Current()` every poll without knowing
  anything about the tray/menu code, and the tray code doesn't know
  anything about tracking.
- `config.go` — all the timing/connection constants, all now used:
  `BackendURL`, `DeviceConfigFileName`, the three from DESIGN.md
  (`HeartbeatIntervalSeconds`, `OfflineThresholdSeconds` — this one is
  backend-only, kept here for reference — `SegmentMaxDurationSeconds`),
  plus `PollIntervalSeconds` and `IdleThresholdSeconds`.
- `platform_windows.go` — the Win32 syscalls (`GetForegroundWindow`,
  `GetWindowTextW`, `GetWindowThreadProcessId`,
  `QueryFullProcessImageName`, `GetLastInputInfo`, `GetTickCount`). The
  only file that touches raw Windows APIs directly; `_windows.go` suffix
  so it's automatically excluded from non-Windows builds.
- `tracker.go` — the polling loop: reads `AgentState`, calls into
  `platform_windows.go`, logs to console, and feeds each observation into
  a `SegmentBuilder`. Closed segments go onto a `SegmentQueue`.
- `segment.go` — `Segment`, `SegmentBuilder` (the poll-stream → segments
  state machine: transitions, app switches, the `SegmentMaxDurationSeconds`
  force-flush) and `SegmentQueue` (the mutex-guarded, in-memory,
  unsent-segment queue shared between the tracker and sender goroutines).
  Covered by `segment_test.go`.
- `device.go` — `DeviceCredentials`, and load-or-register-and-persist
  logic against `device.json` (gitignored), resolved relative to the
  executable's own directory rather than the current working directory.
- `backend.go` — the HTTP client: `registerDevice` and `postEvents`,
  matching the backend's exact JSON contract (including sending `null`,
  not `""`, for `app_name`/`window_title` on idle segments — the backend
  rejects an empty string as neither absent nor null).
- `sender.go` — the heartbeat loop: POSTs whatever's queued every
  `HeartbeatIntervalSeconds`, regardless of pause state (see that file's
  comment for why pause doesn't stop this loop the way it stops
  `tracker.go`'s).
- `assets/icon.ico` — the tray icon, embedded into the binary at compile
  time.

## What's deliberately not here yet

Nothing from the core ingestion path — the agent now registers, tracks,
batches, and posts. Not yet here: any resilience beyond "retry on the next
tick" (no capped/bounded queue — see DESIGN.md's known limitations on the
agent's unbounded retry queue), no persisting the queue across restarts
(an unsent segment surviving a crash or a manual restart is lost — the
in-memory queue is exactly that, in-memory), and no UI feedback in the
tray itself about send failures (only the console shows them).
