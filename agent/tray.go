package main

import (
	_ "embed"

	"github.com/getlantern/systray"
)

// Placeholder icon: a solid orange circle, deliberately bright and simple
// so it doesn't blend into a tray full of gray monochrome icons. Swap it
// by replacing assets/icon.ico with a real one of the same dimensions (or
// any size — Windows will scale it) and rebuilding; no code changes
// needed.
//
//go:embed assets/icon.ico
var iconData []byte

// onReady returns the systray.Run-compatible callback, closed over the
// shared AgentState so menu handlers can read/flip it. This is the only
// file that knows about the tray/menu library; nothing here does any
// activity tracking — see state.go and config.go for the seam where that
// gets added later.
func onReady(state *AgentState) func() {
	return func() {
		systray.SetIcon(iconData)
		systray.SetTooltip("Activity Analytics Agent")

		statusItem := systray.AddMenuItem(statusLabel(state.Current()), "Current agent state")
		statusItem.Disable() // display-only, not clickable

		systray.AddSeparator()

		toggleItem := systray.AddMenuItem(toggleLabel(state.Current()), "Pause or resume activity tracking")

		systray.AddSeparator()

		quitItem := systray.AddMenuItem("Quit", "Stop the agent")

		go func() {
			for {
				select {
				case <-toggleItem.ClickedCh:
					newStatus := state.Toggle()
					statusItem.SetTitle(statusLabel(newStatus))
					toggleItem.SetTitle(toggleLabel(newStatus))
				case <-quitItem.ClickedCh:
					systray.Quit()
					return
				}
			}
		}()
	}
}

// onExit runs after systray.Quit() tears down the tray icon, right before
// Run() returns and the process exits. Nothing to clean up yet — this is
// where a later pass would flush any pending event batch before exiting.
func onExit() {}

func statusLabel(s AgentStatus) string {
	return "Status: " + s.String()
}

func toggleLabel(s AgentStatus) string {
	if s == StatusPaused {
		return "Resume"
	}
	return "Pause"
}
