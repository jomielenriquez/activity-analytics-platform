import type { SegmentType } from '@prisma/client';

// Matches the plan's pinned timing constant: 3 missed 30s heartbeats.
export const OFFLINE_THRESHOLD_SECONDS = 90;

export type DeviceStatus = 'offline' | 'paused' | 'idle' | 'active';

export interface DeviceStatusInput {
  lastSeenAt: Date | null;
  agentStatus: string;
  currentState: SegmentType | null;
}

// device_status derivation, per the plan:
//   last_seen_at older than 90s (or null) -> offline
//   else if agent_status === 'paused'     -> paused
//   else if current_state === idle        -> idle
//   else                                  -> active
// `currentState` is the agent's live self-reported active/idle state, sent
// on every heartbeat (see POST /events) — independent of whether the
// segment reflecting that state has closed yet. This fixes a real lag: the
// previous version derived status from the *latest closed* segment, but a
// newly-opened idle segment doesn't close (and so isn't visible) until a
// transition back to active or its own SEGMENT_MAX_DURATION_SECONDS
// force-flush, up to 300s after the real transition. `currentState` is
// null for a device that hasn't sent a heartbeat yet (e.g. freshly
// registered) — not an error case, it just can't be 'idle', so it falls
// through to the last branch same as any other non-idle state.
export function deriveDeviceStatus(device: DeviceStatusInput): DeviceStatus {
  if (!device.lastSeenAt) {
    return 'offline';
  }

  const secondsSinceLastSeen = (Date.now() - device.lastSeenAt.getTime()) / 1000;
  if (secondsSinceLastSeen > OFFLINE_THRESHOLD_SECONDS) {
    return 'offline';
  }

  if (device.agentStatus === 'paused') {
    return 'paused';
  }

  if (device.currentState === 'idle') {
    return 'idle';
  }

  return 'active';
}
