package main

import "sync"

// AgentStatus mirrors the backend's devices.agent_status values
// ('running' | 'paused' in DESIGN.md) so the eventual event-posting code
// can report it directly without translation.
type AgentStatus int

const (
	StatusRunning AgentStatus = iota
	StatusPaused
)

func (s AgentStatus) String() string {
	if s == StatusPaused {
		return "Paused"
	}
	return "Running"
}

// AgentState is the seam between the tray UI (this pass) and the
// activity-tracking loop (a later pass): the tracker will call Current()
// before recording activity or including a segment in a batch, without
// needing to know anything about the tray/menu implementation. Guarded by
// a mutex since the tray's click handlers and the future tracking
// goroutine will both touch it concurrently.
type AgentState struct {
	mu     sync.RWMutex
	status AgentStatus
}

func NewAgentState() *AgentState {
	return &AgentState{status: StatusRunning}
}

func (s *AgentState) Current() AgentStatus {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.status
}

// Toggle flips Running<->Paused and returns the new status.
func (s *AgentState) Toggle() AgentStatus {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.status == StatusRunning {
		s.status = StatusPaused
	} else {
		s.status = StatusRunning
	}
	return s.status
}

// LiveState is the agent's live self-reported active/idle state: what the
// tracker's most recent poll observed, independent of whether the segment
// reflecting that state has closed yet. Guarded by a mutex since the
// tracker goroutine (writer, every poll tick) and the sender goroutine
// (reader, every heartbeat) touch it concurrently. This is what fixes the
// status-lag gap described in DESIGN.md's device status derivation: without
// it, the backend can only know the device's state from the latest
// *closed* segment, which can be up to SegmentMaxDurationSeconds stale
// after a real transition.
//
// Alongside active/idle, it tracks stateDuration: how long the device has
// been continuously in that state, in PollIntervalSeconds-sized
// increments — reset to 0 on a flip, incremented on every tick that
// confirms the same state. This is deliberately tick-counted rather than
// wall-clock-measured (e.g. time.Since a stored timestamp): it stays exact
// even if a tick is skipped while paused (RunTracker doesn't call Set at
// all while paused, so duration simply stops advancing rather than jumping
// by the paused interval once resumed).
type LiveState struct {
	mu       sync.RWMutex
	active   bool
	duration int
}

// NewLiveState defaults to active — the first poll tick (PollIntervalSeconds
// after startup, well before the first heartbeat) corrects this immediately
// if the device actually starts out idle.
func NewLiveState() *LiveState {
	return &LiveState{active: true}
}

// Set records one poll tick's active/idle observation. Same state as last
// tick: stateDuration advances by PollIntervalSeconds. Different: the state
// flips and stateDuration resets to 0 for the new state.
func (s *LiveState) Set(active bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if active == s.active {
		s.duration += PollIntervalSeconds
	} else {
		s.active = active
		s.duration = 0
	}
}

// CurrentState returns "active" or "idle", matching the backend's
// current_state values.
func (s *LiveState) CurrentState() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.active {
		return "active"
	}
	return "idle"
}

// StateDurationSeconds returns how long the device has been continuously
// in CurrentState(), matching the backend's state_duration_seconds field.
func (s *LiveState) StateDurationSeconds() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.duration
}
