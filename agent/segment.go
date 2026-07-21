package main

import (
	"crypto/rand"
	"fmt"
	"sync"
	"time"
)

// newClientSegmentID generates an RFC 4122 v4 UUID. Hand-rolled instead of
// pulling in a UUID library: it's ~8 lines over crypto/rand, and the
// backend's own client_segment_id validation just checks the UUID shape,
// not strict RFC compliance, so there's no reason to add a dependency for
// this.
func newClientSegmentID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	b[6] = (b[6] & 0x0f) | 0x40 // version 4
	b[8] = (b[8] & 0x3f) | 0x80 // variant 10
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

// PollSample is one poll tick's observation, as produced by tracker.go and
// fed into SegmentBuilder.Observe.
type PollSample struct {
	Active      bool
	AppName     string
	WindowTitle string
}

// Segment mirrors the backend's POST /api/v1/events event shape.
type Segment struct {
	ClientSegmentID string
	Type            string // "active" | "idle"
	AppName         string // empty for idle
	WindowTitle     string // empty for idle
	StartedAt       time.Time
	EndedAt         time.Time
	DurationSeconds int
}

// SegmentBuilder turns the raw poll stream into closed segments, per
// DESIGN.md's model: a segment starts when the active/idle state changes,
// or when the foreground app changes while active. A window-title change
// alone, with the same app and activity state, does *not* start a new
// segment — DESIGN.md only specifies state and app-switch as boundaries —
// but the open segment's recorded title is kept updated to the latest
// observed value, so whatever's showing when the segment eventually
// closes is what gets recorded, not whatever was showing when it opened.
//
// Not safe for concurrent use — only the tracker goroutine calls Observe.
type SegmentBuilder struct {
	open *openSegment
}

type openSegment struct {
	clientSegmentID string
	active          bool
	appName         string
	windowTitle     string
	startedAt       time.Time
}

func NewSegmentBuilder() *SegmentBuilder {
	return &SegmentBuilder{}
}

// Observe records one poll sample at time `now`. It returns a closed
// Segment if this observation caused one (a transition, or a
// SegmentMaxDurationSeconds force-flush), or ok=false if the sample just
// extended the currently open segment (or started the very first one,
// which can't have anything to close yet).
func (b *SegmentBuilder) Observe(sample PollSample, now time.Time) (closed Segment, ok bool) {
	if b.open == nil {
		b.startNew(sample, now)
		return Segment{}, false
	}

	// Force-flush: closes the current segment and immediately reopens an
	// identical one (same app/state), per DESIGN.md's documented
	// behavior, so a long-running session doesn't leave the dashboard
	// stale on "what's happening now."
	if now.Sub(b.open.startedAt) >= SegmentMaxDurationSeconds*time.Second {
		closed = b.close(now)
		b.startNew(sample, now)
		return closed, true
	}

	transitioned := sample.Active != b.open.active ||
		(sample.Active && sample.AppName != b.open.appName)

	if transitioned {
		closed = b.close(now)
		b.startNew(sample, now)
		return closed, true
	}

	// Same segment continues — just keep its recorded title current.
	if sample.Active {
		b.open.windowTitle = sample.WindowTitle
	}
	return Segment{}, false
}

// Flush force-closes whatever segment is currently open, if any — used on
// shutdown so an in-progress segment isn't silently lost.
func (b *SegmentBuilder) Flush(now time.Time) (closed Segment, ok bool) {
	if b.open == nil {
		return Segment{}, false
	}
	closed = b.close(now)
	b.open = nil
	return closed, true
}

func (b *SegmentBuilder) startNew(sample PollSample, now time.Time) {
	b.open = &openSegment{
		clientSegmentID: newClientSegmentID(),
		active:          sample.Active,
		appName:         sample.AppName,
		windowTitle:     sample.WindowTitle,
		startedAt:       now,
	}
}

func (b *SegmentBuilder) close(now time.Time) Segment {
	segType := "idle"
	appName, windowTitle := "", ""
	if b.open.active {
		segType = "active"
		appName, windowTitle = b.open.appName, b.open.windowTitle
	}

	return Segment{
		ClientSegmentID: b.open.clientSegmentID,
		Type:            segType,
		AppName:         appName,
		WindowTitle:     windowTitle,
		StartedAt:       b.open.startedAt,
		EndedAt:         now,
		DurationSeconds: int(now.Sub(b.open.startedAt).Seconds()),
	}
}

// SegmentQueue is the in-memory queue of closed, unsent segments, shared
// between the tracker goroutine (producer) and the event-sender goroutine
// (consumer). Mutex-guarded since both touch it concurrently.
type SegmentQueue struct {
	mu    sync.Mutex
	items []Segment
}

func NewSegmentQueue() *SegmentQueue {
	return &SegmentQueue{}
}

func (q *SegmentQueue) Enqueue(seg Segment) {
	q.mu.Lock()
	defer q.mu.Unlock()
	q.items = append(q.items, seg)
}

// Snapshot returns a copy of everything currently queued, for the sender
// to attempt posting without holding the lock during the HTTP call.
func (q *SegmentQueue) Snapshot() []Segment {
	q.mu.Lock()
	defer q.mu.Unlock()
	out := make([]Segment, len(q.items))
	copy(out, q.items)
	return out
}

// RemoveSent drops the given segments (by ClientSegmentID) from the
// queue — called only after a confirmed 2xx response. Segments enqueued
// after the snapshot was taken (i.e. not in sentIDs) are left alone, so
// nothing produced during an in-flight send gets dropped.
func (q *SegmentQueue) RemoveSent(sentIDs map[string]bool) {
	q.mu.Lock()
	defer q.mu.Unlock()

	remaining := q.items[:0]
	for _, item := range q.items {
		if !sentIDs[item.ClientSegmentID] {
			remaining = append(remaining, item)
		}
	}
	q.items = remaining
}
