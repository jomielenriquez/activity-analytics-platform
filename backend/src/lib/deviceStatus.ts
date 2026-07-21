import type { SegmentType } from '@prisma/client';
import { prisma } from '../db';

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

// Latest segment type per device, in one query rather than one query per
// device: Prisma's query builder has no "latest related row per parent"
// primitive (no window functions), so this uses Postgres's DISTINCT ON,
// which the existing idx_segments_device_time (device_id, started_at)
// index makes cheap. Shared by any endpoint that needs current derived
// status for some or all devices (device list/detail, stats/summary).
export async function getLatestSegmentTypeByDevice(): Promise<Map<string, SegmentType>> {
  const rows = await prisma.$queryRaw<{ device_id: string; type: SegmentType }[]>`
    SELECT DISTINCT ON (device_id) device_id, type
    FROM activity_segments
    ORDER BY device_id, started_at DESC
  `;
  return new Map(rows.map((row) => [row.device_id, row.type]));
}
