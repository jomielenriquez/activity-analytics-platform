package main

import (
	"log"
	"time"
)

// RunTracker polls the foreground window and idle state on
// PollIntervalSeconds, logs what it finds, and feeds each observation into
// builder to turn the raw poll stream into segments — closed segments are
// pushed onto queue for sender.go to eventually POST.
//
// It respects AgentState: while paused, polling stops entirely (the
// ticker still fires, but nothing is queried or fed to the builder), not
// just "stops reporting" — so pausing has a real effect on what the agent
// does, not just what it prints. Note this is a different loop from
// sender.go's heartbeat loop, which keeps running while paused (see that
// file's comment for why).
//
// live is updated on every poll tick (not just on transitions the
// SegmentBuilder cares about) so sender.go always has an up-to-the-tick
// answer for "what's the device doing right now" to put in current_state,
// regardless of whether that state's segment has closed yet.
func RunTracker(state *AgentState, builder *SegmentBuilder, queue *SegmentQueue, live *LiveState) {
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

		poll(builder, queue, live)
	}
}

func poll(builder *SegmentBuilder, queue *SegmentQueue, live *LiveState) {
	idle, err := idleSeconds()
	if err != nil {
		log.Printf("[tracker] idle check failed: %v", err)
		return
	}

	sample := PollSample{Active: idle < IdleThresholdSeconds}
	live.Set(sample.Active)

	if sample.Active {
		title, exeName, ok := foregroundWindowInfo()
		if !ok {
			// Active but can't identify the foreground app right now (a
			// transient desktop-focus blip, or a protected process) — an
			// active segment needs a real app name, so skip building from
			// this sample rather than record a bogus one. The currently
			// open segment (if any) just continues; nothing is lost.
			log.Printf("[tracker] active | idle=%.0fs | (no foreground window info — skipping)", idle)
			return
		}
		if title == "" {
			// A real Win32 window can legitimately have no title (seen live:
			// OpenWith.exe's foreground window). The backend requires a
			// non-empty window_title for active segments, so substitute an
			// explicit placeholder rather than send "" (rejected as
			// "missing", identically to actually missing) or drop the
			// segment entirely (losing real activity time).
			title = "(no window title)"
		}
		sample.AppName, sample.WindowTitle = exeName, title
		log.Printf("[tracker] active | idle=%.0fs | app=%s | title=%q", idle, exeName, title)
	} else {
		// Idle segments don't carry app/title, so no need for foreground
		// window info to observe one.
		log.Printf("[tracker] idle | idle=%.0fs", idle)
	}

	closed, ok := builder.Observe(sample, time.Now())
	if !ok {
		return
	}

	queue.Enqueue(closed)
	log.Printf("[tracker] segment closed and queued: id=%s type=%s app=%q duration=%ds",
		closed.ClientSegmentID, closed.Type, closed.AppName, closed.DurationSeconds)
}
