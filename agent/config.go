package main

// Timing constants from DESIGN.md's "Timing constants" section — kept in
// sync with the backend's contract. HeartbeatIntervalSeconds and
// SegmentMaxDurationSeconds aren't used yet (no event-posting/segment
// code exists this pass); this is where that code will read them from
// once built.
const (
	// HeartbeatIntervalSeconds is the agent's tick cadence for talking to
	// the *backend*: how often it pings/flushes to POST /api/v1/events,
	// regardless of activity. Not to be confused with PollIntervalSeconds
	// below, which governs local OS polling — see that constant's comment
	// for why they're deliberately separate.
	HeartbeatIntervalSeconds = 30

	// OfflineThresholdSeconds is enforced server-side (see
	// deriveDeviceStatus in the backend), not by the agent itself — kept
	// here anyway so the full timing model from DESIGN.md lives in one
	// place in this codebase too.
	OfflineThresholdSeconds = 90

	// SegmentMaxDurationSeconds: an open segment (e.g. one app left in
	// focus for hours) gets force-flushed on this cadence even without a
	// transition, so the backend is never more than this long stale on
	// "what's happening now."
	SegmentMaxDurationSeconds = 300

	// PollIntervalSeconds controls how often the tracker samples the
	// foreground window and idle time *locally*. This is a different
	// concern from HeartbeatIntervalSeconds above: that one is about how
	// often the agent talks to the backend; this one is about how often it
	// samples the OS to detect an app switch responsively. A later pass
	// will accumulate polled samples into segments in memory and flush
	// those to the backend on the heartbeat cadence, not the poll cadence
	// — the two constants serve different layers and shouldn't be merged
	// or confused with each other.
	PollIntervalSeconds = 3

	// IdleThresholdSeconds: no keyboard/mouse input for at least this long
	// counts as idle. 5 minutes, matching what DESIGN.md's backend plan
	// already assumes for idle/active segmentation.
	IdleThresholdSeconds = 5 * 60
)
