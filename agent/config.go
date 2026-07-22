package main

// Backend connection. Change this to point the agent at a different
// environment (staging, a teammate's local backend, etc.) — this is the
// only place it's defined.
const BackendURL = "http://localhost:3000"

// DeviceConfigPath is where registered device credentials (device_id +
// api_key) are persisted between runs, resolved relative to the
// executable's own directory (not the current working directory, which
// varies depending on how the agent gets launched — double-click, a
// shortcut, or Windows startup). Gitignored; see device.go.
const DeviceConfigFileName = "device.json"

// LogFileName is where log output goes, resolved the same way as
// DeviceConfigFileName (next to the executable). Since this build is
// compiled with -H=windowsgui (no console subsystem — see agent/README.md),
// there's no attached console for the standard `log` package's default
// output to reach; this file is the only way to see what the agent is
// doing. Gitignored via the root .gitignore's `*.log` rule.
const LogFileName = "agent.log"

// Timing constants from DESIGN.md's "Timing constants" section — kept in
// sync with the backend's contract.
const (
	// HeartbeatIntervalSeconds is the agent's tick cadence for talking to
	// the *backend*: how often it POSTs to /api/v1/events — whatever
	// segments are queued (often none) plus the current agent_status,
	// which is also this agent's liveness ping. Not to be confused with
	// PollIntervalSeconds below, which governs local OS polling — see that
	// constant's comment for why they're deliberately separate.
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
	// samples the OS to detect an app switch responsively. Polled samples
	// are accumulated into segments in memory and flushed to the backend
	// on the heartbeat cadence, not the poll cadence — the two constants
	// serve different layers and shouldn't be merged or confused with each
	// other.
	PollIntervalSeconds = 3

	// IdleThresholdSeconds: no keyboard/mouse input for at least this long
	// counts as idle. 5 minutes, matching what DESIGN.md's backend plan
	// already assumes for idle/active segmentation.
	IdleThresholdSeconds = 5 * 60
)
