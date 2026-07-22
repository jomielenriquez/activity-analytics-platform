package main

import (
	"log"

	"fyne.io/systray"
)

func main() {
	if logFile, err := setupFileLogging(); err != nil {
		// Not fatal: logging setup failing shouldn't take down a tray app
		// over what's ultimately a debug-visibility concern. This message
		// itself lands wherever the default logger was pointed before this
		// call (stderr) — invisible under the -H=windowsgui build this
		// ships as, but harmless, and still useful if ever run from a
		// console build for debugging.
		log.Printf("[log] failed to set up file logging, continuing without it: %v", err)
	} else {
		defer logFile.Close()
	}

	state := NewAgentState()
	queue := NewSegmentQueue()
	builder := NewSegmentBuilder()
	live := NewLiveState()

	// Not fatal if this fails (e.g. backend not up yet): the tray still
	// starts so the agent is visible/stoppable, and sender.go retries
	// registration on every heartbeat tick until it succeeds.
	creds, err := loadOrRegisterDevice()
	if err != nil {
		log.Printf("[device] registration failed at startup, will retry on the heartbeat ticker: %v", err)
	}

	go RunTracker(state, builder, queue, live)
	go RunEventSender(state, queue, creds, live)

	systray.Run(onReady(state), onExit)
}
