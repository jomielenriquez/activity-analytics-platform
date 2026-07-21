import type { SegmentType } from '@prisma/client';

// Matches the plan's pinned timing constant: 3 missed 30s heartbeats.
export const OFFLINE_THRESHOLD_SECONDS = 90;

export type DeviceStatus = 'offline' | 'paused' | 'idle' | 'active';

export interface DeviceStatusInput {
  lastSeenAt: Date | null;
  agentStatus: string;
}

// device_status derivation, per the plan:
//   last_seen_at older than 90s (or null) -> offline
//   else if agent_status === 'paused'     -> paused
//   else if latest segment type === idle  -> idle
//   else                                  -> active
// `latestSegmentType` is null for a device that hasn't reported any
// segments yet (e.g. freshly registered) — that's not an error case, it
// just can't be 'idle', so it falls through to the last branch same as any
// other non-idle state.
export function deriveDeviceStatus(
  device: DeviceStatusInput,
  latestSegmentType: SegmentType | null,
): DeviceStatus {
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

  if (latestSegmentType === 'idle') {
    return 'idle';
  }

  return 'active';
}
