package main

import (
	"log"

	"fyne.io/systray"
)

func main() {
	state := NewAgentState()
	queue := NewSegmentQueue()
	builder := NewSegmentBuilder()

	// Not fatal if this fails (e.g. backend not up yet): the tray still
	// starts so the agent is visible/stoppable, and sender.go retries
	// registration on every heartbeat tick until it succeeds.
	creds, err := loadOrRegisterDevice()
	if err != nil {
		log.Printf("[device] registration failed at startup, will retry on the heartbeat ticker: %v", err)
	}

	go RunTracker(state, builder, queue)
	go RunEventSender(state, queue, creds)

	systray.Run(onReady(state), onExit)
}
