package main

// Timing constants from DESIGN.md's "Timing constants" section — kept in
// sync with the backend's contract. Not used yet in this pass (no
// tracking loop exists); this is where that loop will read them from once
// built.
const (
	// HeartbeatIntervalSeconds is the agent's tick cadence: how often it
	// pings/flushes to POST /api/v1/events, regardless of activity.
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
)
