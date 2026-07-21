# Activity Analytics Agent

Windows system-tray agent. This first pass is the visible tray shell only —
a status label, a Pause/Resume toggle, and Quit. No activity tracking, no
network calls yet; see [DESIGN.md](../DESIGN.md) for what's planned on top
of this.

## Build and run (Windows)

Requires Go 1.21+ (developed against 1.26.5).

```
cd agent
go mod tidy
go build -ldflags="-H=windowsgui" -o agent.exe .
.\agent.exe
```

The `-ldflags="-H=windowsgui"` flag matters: without it, `go build`
produces a console-subsystem binary, and a console window pops up
alongside the tray icon every time you run it. `-H=windowsgui` builds it
as a GUI-subsystem binary instead — tray icon only, no console window.

You should see a bright orange circular icon appear in the system tray
(may be in the hidden-icons overflow area — check there if it's not
immediately visible). Right-click (or left-click, depending on your
Windows version/taskbar settings) it for the menu: a "Status: Running"
label, "Pause" (which flips to "Resume" and back), and "Quit".

To stop it without the menu: `taskkill /IM agent.exe /F` from another
terminal, or Task Manager.

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
  guarded by a mutex. This is the seam the next pass (activity tracking)
  will read from — `state.Current()` — without needing to know anything
  about the tray/menu code, and without the tray code needing to know
  anything about tracking.
- `config.go` — timing constants from DESIGN.md
  (`HeartbeatIntervalSeconds`, `OfflineThresholdSeconds`,
  `SegmentMaxDurationSeconds`). Not used yet; declared here so the next
  pass has them in one place from the start.
- `assets/icon.ico` — the tray icon, embedded into the binary at compile
  time.

## What's deliberately not here yet

No foreground-window polling, no idle detection (`GetLastInputInfo`), no
HTTP client, no event batching or posting to the backend. Those land in
the next pass, reading `AgentState.Current()` to decide whether to record
anything and reading the constants in `config.go` for timing.
