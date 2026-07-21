package main

import (
	"log"
	"time"
)

// RunTracker polls the foreground window and idle state on
// PollIntervalSeconds and logs what it finds to the console. This pass
// only logs — no segment construction, no batching, no HTTP client; that
// lands in the next pass, reading these same samples.
//
// It respects AgentState: while paused, polling stops entirely (the
// ticker still fires, but foregroundWindowInfo/idleSeconds are never
// called), not just "stops reporting" — so pausing has a real effect on
// what the agent does, not just what it prints.
func RunTracker(state *AgentState) {
	ticker := time.NewTicker(PollIntervalSeconds * time.Second)
	defer ticker.Stop()

	log.Println("[tracker] polling started")
	paused := false

	for range ticker.C {
		if state.Current() == StatusPaused {
			if !paused {
				log.Println("[tracker] paused — polling stopped")
				paused = true
			}
			continue
		}

		if paused {
			log.Println("[tracker] resumed — polling started")
			paused = false
		}

		poll()
	}
}

func poll() {
	idle, err := idleSeconds()
	if err != nil {
		log.Printf("[tracker] idle check failed: %v", err)
		return
	}

	activity := "active"
	if idle >= IdleThresholdSeconds {
		activity = "idle"
	}

	title, exeName, ok := foregroundWindowInfo()
	if !ok {
		log.Printf("[tracker] %s | idle=%.0fs | (no foreground window)", activity, idle)
		return
	}

	log.Printf("[tracker] %s | idle=%.0fs | app=%s | title=%q", activity, idle, exeName, title)
}
