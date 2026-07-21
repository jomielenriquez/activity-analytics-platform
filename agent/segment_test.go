package main

import (
	"testing"
	"time"
)

func TestSegmentBuilder_FirstObservationOpensWithNothingToClose(t *testing.T) {
	b := NewSegmentBuilder()
	now := time.Now()

	_, ok := b.Observe(PollSample{Active: true, AppName: "chrome.exe", WindowTitle: "t"}, now)
	if ok {
		t.Fatal("expected no closed segment on the very first observation")
	}
}

func TestSegmentBuilder_SameAppContinuesWithoutClosing(t *testing.T) {
	b := NewSegmentBuilder()
	now := time.Now()

	b.Observe(PollSample{Active: true, AppName: "chrome.exe", WindowTitle: "tab 1"}, now)
	_, ok := b.Observe(PollSample{Active: true, AppName: "chrome.exe", WindowTitle: "tab 2"}, now.Add(3*time.Second))
	if ok {
		t.Fatal("a title change alone (same app, same active state) should not close a segment")
	}
}

func TestSegmentBuilder_AppSwitchClosesAndOpensNewSegment(t *testing.T) {
	b := NewSegmentBuilder()
	start := time.Now()

	b.Observe(PollSample{Active: true, AppName: "chrome.exe", WindowTitle: "t1"}, start)
	switchTime := start.Add(10 * time.Second)
	closed, ok := b.Observe(PollSample{Active: true, AppName: "notepad.exe", WindowTitle: "t2"}, switchTime)

	if !ok {
		t.Fatal("expected a closed segment on app switch")
	}
	if closed.Type != "active" || closed.AppName != "chrome.exe" {
		t.Fatalf("closed segment should be the chrome.exe one, got type=%s app=%s", closed.Type, closed.AppName)
	}
	if closed.StartedAt != start || closed.EndedAt != switchTime {
		t.Fatalf("unexpected started_at/ended_at: got %v/%v, want %v/%v", closed.StartedAt, closed.EndedAt, start, switchTime)
	}
	if closed.DurationSeconds != 10 {
		t.Fatalf("expected duration_seconds=10, got %d", closed.DurationSeconds)
	}
	if closed.ClientSegmentID == "" {
		t.Fatal("expected a non-empty client_segment_id")
	}

	// The new segment shouldn't close on the next identical observation.
	_, ok = b.Observe(PollSample{Active: true, AppName: "notepad.exe", WindowTitle: "t2"}, switchTime.Add(1*time.Second))
	if ok {
		t.Fatal("newly opened segment should not immediately close")
	}
}

func TestSegmentBuilder_ActiveToIdleTransition(t *testing.T) {
	b := NewSegmentBuilder()
	start := time.Now()

	b.Observe(PollSample{Active: true, AppName: "chrome.exe", WindowTitle: "t"}, start)
	idleTime := start.Add(5 * time.Second)
	closed, ok := b.Observe(PollSample{Active: false}, idleTime)

	if !ok {
		t.Fatal("expected a closed segment on active->idle transition")
	}
	if closed.Type != "active" || closed.AppName != "chrome.exe" {
		t.Fatalf("closed segment should be the active chrome.exe one, got type=%s app=%s", closed.Type, closed.AppName)
	}

	// The new (idle) segment must not carry over app/title.
	closedIdle, ok := b.Flush(idleTime.Add(2 * time.Second))
	if !ok {
		t.Fatal("expected Flush to close the open idle segment")
	}
	if closedIdle.Type != "idle" {
		t.Fatalf("expected type=idle, got %s", closedIdle.Type)
	}
	if closedIdle.AppName != "" || closedIdle.WindowTitle != "" {
		t.Fatalf("idle segment must not carry app_name/window_title, got app=%q title=%q", closedIdle.AppName, closedIdle.WindowTitle)
	}
}

func TestSegmentBuilder_ForceFlushOnMaxDuration(t *testing.T) {
	b := NewSegmentBuilder()
	start := time.Now()

	b.Observe(PollSample{Active: true, AppName: "chrome.exe", WindowTitle: "t"}, start)

	// Same sample, but enough wall-clock time has passed to exceed
	// SegmentMaxDurationSeconds without any transition.
	flushTime := start.Add(SegmentMaxDurationSeconds * time.Second)
	closed, ok := b.Observe(PollSample{Active: true, AppName: "chrome.exe", WindowTitle: "t"}, flushTime)

	if !ok {
		t.Fatal("expected a force-flushed segment at SegmentMaxDurationSeconds")
	}
	if closed.DurationSeconds != SegmentMaxDurationSeconds {
		t.Fatalf("expected duration_seconds=%d, got %d", SegmentMaxDurationSeconds, closed.DurationSeconds)
	}
	if closed.AppName != "chrome.exe" {
		t.Fatalf("force-flushed segment should still be chrome.exe, got %s", closed.AppName)
	}

	// The replacement segment must start exactly where the flushed one
	// ended (no gap), with the same app/state, and must NOT immediately
	// close again on the very next observation.
	next, ok := b.Observe(PollSample{Active: true, AppName: "chrome.exe", WindowTitle: "t"}, flushTime.Add(1*time.Second))
	if ok {
		t.Fatalf("segment reopened after force-flush closed again too early: %+v", next)
	}

	closedAgain, ok := b.Flush(flushTime.Add(2 * time.Second))
	if !ok {
		t.Fatal("expected Flush to close the segment reopened after the force-flush")
	}
	if closedAgain.StartedAt != flushTime {
		t.Fatalf("reopened segment should start exactly at the force-flush time (no gap), got %v want %v", closedAgain.StartedAt, flushTime)
	}
}

func TestSegmentBuilder_FlushWithNothingOpenIsNoop(t *testing.T) {
	b := NewSegmentBuilder()
	_, ok := b.Flush(time.Now())
	if ok {
		t.Fatal("Flush on a builder with nothing open should report ok=false")
	}
}

func TestSegmentQueue_RemoveSentLeavesLaterAdditionsAlone(t *testing.T) {
	q := NewSegmentQueue()
	seg1 := Segment{ClientSegmentID: "id-1"}
	seg2 := Segment{ClientSegmentID: "id-2"}
	q.Enqueue(seg1)

	snapshot := q.Snapshot() // simulates the sender taking a snapshot before its HTTP call

	// A new segment arrives while the (simulated) send is "in flight".
	q.Enqueue(seg2)

	sentIDs := map[string]bool{}
	for _, s := range snapshot {
		sentIDs[s.ClientSegmentID] = true
	}
	q.RemoveSent(sentIDs)

	remaining := q.Snapshot()
	if len(remaining) != 1 || remaining[0].ClientSegmentID != "id-2" {
		t.Fatalf("expected only id-2 to remain queued, got %+v", remaining)
	}
}
