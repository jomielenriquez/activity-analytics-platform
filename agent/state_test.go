package main

import "testing"

func TestLiveState_DefaultsToActive(t *testing.T) {
	live := NewLiveState()
	if got := live.CurrentState(); got != "active" {
		t.Fatalf("expected default state %q, got %q", "active", got)
	}
	if got := live.StateDurationSeconds(); got != 0 {
		t.Fatalf("expected default state_duration_seconds 0, got %d", got)
	}
}

func TestLiveState_DurationAccumulatesAcrossTicksInTheSameState(t *testing.T) {
	live := NewLiveState()

	// Three consecutive ticks confirming the same state (active, matching
	// the default) should each advance stateDuration by PollIntervalSeconds
	// — not by wall-clock time, and not just on the first tick.
	live.Set(true)
	live.Set(true)
	live.Set(true)

	want := 3 * PollIntervalSeconds
	if got := live.StateDurationSeconds(); got != want {
		t.Fatalf("expected state_duration_seconds %d after 3 same-state ticks, got %d", want, got)
	}
}

func TestLiveState_DurationResetsOnTransitionAndReaccumulates(t *testing.T) {
	live := NewLiveState()

	// Build up some duration in the active state.
	live.Set(true)
	live.Set(true)
	if got := live.StateDurationSeconds(); got != 2*PollIntervalSeconds {
		t.Fatalf("setup: expected %d, got %d", 2*PollIntervalSeconds, got)
	}

	// The transition tick itself must reset to 0, not carry over the
	// previous state's accumulated duration — this is the exact bug the
	// dashboard's "Idle for Xm Ys" display depends on not having: a stale
	// duration on the new state would misreport how long the device has
	// actually been idle.
	live.Set(false)
	if got := live.StateDurationSeconds(); got != 0 {
		t.Fatalf("expected state_duration_seconds to reset to 0 on transition, got %d", got)
	}
	if got := live.CurrentState(); got != "idle" {
		t.Fatalf("expected state %q after transition, got %q", "idle", got)
	}

	// And it accumulates again from 0 in the new state.
	live.Set(false)
	live.Set(false)
	if got := live.StateDurationSeconds(); got != 2*PollIntervalSeconds {
		t.Fatalf("expected state_duration_seconds %d after 2 more idle ticks, got %d", 2*PollIntervalSeconds, got)
	}
}

func TestLiveState_ReflectsTransitionImmediately(t *testing.T) {
	live := NewLiveState()

	// This is the crux of the fix: LiveState reports whatever the most
	// recent poll observed, with no dependency on whether that observation
	// caused a segment to close. SegmentBuilder can leave a transition's
	// new segment open for up to SegmentMaxDurationSeconds; LiveState must
	// not wait for that.
	live.Set(false)
	if got := live.CurrentState(); got != "idle" {
		t.Fatalf("expected %q immediately after Set(false), got %q", "idle", got)
	}

	live.Set(true)
	if got := live.CurrentState(); got != "active" {
		t.Fatalf("expected %q immediately after Set(true), got %q", "active", got)
	}
}
