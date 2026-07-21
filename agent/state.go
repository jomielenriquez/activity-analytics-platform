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
