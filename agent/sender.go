package main

import (
	"log"
	"time"
)

// RunEventSender POSTs whatever's queued to /api/v1/events every
// HeartbeatIntervalSeconds. Unlike RunTracker, this loop keeps running
// regardless of pause state: POST /events is also this agent's liveness
// ping and the only way the backend learns agent_status is "paused"
// rather than just going stale and eventually reading as "offline" — see
// DESIGN.md's device status derivation (paused is only distinguishable
// from offline while last_seen_at is still recent). Stopping this loop on
// pause would make a paused agent indistinguishable from a dead one after
// OfflineThresholdSeconds.
//
// creds may start nil if registration failed at startup (e.g. backend not
// reachable yet); this loop retries registration each tick until it
// succeeds, rather than requiring the agent to be restarted once the
// backend comes back.
func RunEventSender(state *AgentState, queue *SegmentQueue, creds *DeviceCredentials, live *LiveState) {
	ticker := time.NewTicker(HeartbeatIntervalSeconds * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		if creds == nil {
			var err error
			creds, err = loadOrRegisterDevice()
			if err != nil {
				log.Printf("[sender] still no device credentials, skipping this tick: %v", err)
				continue
			}
		}

		agentStatus := "running"
		if state.Current() == StatusPaused {
			agentStatus = "paused"
		}

		segments := queue.Snapshot()
		currentState := live.CurrentState()
		stateDuration := live.StateDurationSeconds()
		log.Printf("[sender] sending %d segment(s), agent_status=%s, current_state=%s, state_duration_seconds=%d",
			len(segments), agentStatus, currentState, stateDuration)

		accepted, duplicates, err := postEvents(creds, agentStatus, currentState, stateDuration, segments)
		if err != nil {
			log.Printf("[sender] send failed, %d segment(s) remain queued for next tick: %v", len(segments), err)
			continue
		}

		log.Printf("[sender] batch sent: accepted=%d duplicates=%d", accepted, duplicates)

		sentIDs := make(map[string]bool, len(segments))
		for _, seg := range segments {
			sentIDs[seg.ClientSegmentID] = true
		}
		queue.RemoveSent(sentIDs)
	}
}
