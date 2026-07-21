# Activity Analytics Agent

Windows system-tray agent. Current state: the tray shell (status label,
Pause/Resume toggle, Quit) plus foreground-app and idle-state detection,
logged to the console for manual verification. No network calls, no
segment construction/batching yet; see [DESIGN.md](../DESIGN.md) for what's
planned on top of this.

## Build and run (Windows)

Requires Go 1.21+ (developed against 1.26.5).

```
cd agent
go mod tidy
go build -o agent.exe .
.\agent.exe
```

This build is **console-subsystem** (no `-ldflags="-H=windowsgui"`)
deliberately, for now: the tracking output below is only useful if you can
actually see it, and a GUI-subsystem binary has no attached console to
print to. A console window will appear alongside the tray icon while this
is the case. Once tracking is verified and wired to the backend (posting
over HTTP instead of printing), console output stops being the way this
gets checked, and `-ldflags="-H=windowsgui"` (documented in the earlier
version of this file / git history) should come back for a quiet,
tray-only build.

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
- `config.go` — timing constants: the three from DESIGN.md
  (`HeartbeatIntervalSeconds`, `OfflineThresholdSeconds`,
  `SegmentMaxDurationSeconds`, still unused — for the next pass) plus two
  local ones actually used by the tracker now: `PollIntervalSeconds` (how
  often the tracker samples the OS locally — a different concern from
  `HeartbeatIntervalSeconds`, see the comment on that constant) and
  `IdleThresholdSeconds` (5 minutes of no input = idle).
- `platform_windows.go` — the Win32 syscalls (`GetForegroundWindow`,
  `GetWindowTextW`, `GetWindowThreadProcessId`,
  `QueryFullProcessImageName`, `GetLastInputInfo`, `GetTickCount`). The
  only file that touches raw Windows APIs directly; `_windows.go` suffix
  so it's automatically excluded from non-Windows builds.
- `tracker.go` — the polling loop: reads `AgentState`, calls into
  `platform_windows.go`, logs to console. No segment construction, no
  HTTP client — see below.
- `assets/icon.ico` — the tray icon, embedded into the binary at compile
  time.

## What's deliberately not here yet

No HTTP client, no event batching, no segment construction (turning raw
poll samples into the `{ client_segment_id, type, started_at, ended_at,
duration_seconds }` shape the backend's `POST /events` expects), no
posting to the backend at all. Those land in the next pass, consuming the
same `foregroundWindowInfo()`/`idleSeconds()` calls this pass already logs,
plus `HeartbeatIntervalSeconds` and `SegmentMaxDurationSeconds` from
`config.go`, which are still unused today.
