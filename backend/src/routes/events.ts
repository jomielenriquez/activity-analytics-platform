import { Router } from 'express';
import type { SegmentType } from '@prisma/client';
import { prisma } from '../db';
import { requireDeviceAuth } from '../middleware/auth';
import { isNonEmptyString, isUuid } from '../validation';

export const eventsRouter = Router();

const WINDOW_TITLE_MAX_LENGTH = 512;

// Pass-through stub for now (just truncates) — the documented seam where
// real redaction (e.g. always blanking titles for known password managers)
// plugs in later without touching callers or the schema.
function redactWindowTitle(title: string, _appName: string | null): string {
  return title.length > WINDOW_TITLE_MAX_LENGTH ? title.slice(0, WINDOW_TITLE_MAX_LENGTH) : title;
}

function isValidDateString(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(new Date(value).getTime());
}

interface ValidatedRow {
  clientSegmentId: string;
  type: SegmentType;
  appName: string | null;
  windowTitle: string | null;
  startedAt: Date;
  endedAt: Date;
  durationSeconds: number;
}

function validateEvent(raw: unknown, index: number): { errors: string[]; row?: ValidatedRow } {
  const errors: string[] = [];
  const prefix = `events[${index}]`;
  const event = (raw ?? {}) as Record<string, unknown>;

  if (!isUuid(event.client_segment_id)) {
    errors.push(`${prefix}.client_segment_id must be a UUID string`);
  }

  const type = event.type;
  if (type !== 'active' && type !== 'idle') {
    errors.push(`${prefix}.type must be 'active' or 'idle'`);
  }

  if (!isValidDateString(event.started_at)) {
    errors.push(`${prefix}.started_at must be a valid ISO timestamp`);
  }
  if (!isValidDateString(event.ended_at)) {
    errors.push(`${prefix}.ended_at must be a valid ISO timestamp`);
  }
  if (!Number.isInteger(event.duration_seconds) || (event.duration_seconds as number) < 0) {
    errors.push(`${prefix}.duration_seconds must be a non-negative integer`);
  }

  if (type === 'active') {
    if (!isNonEmptyString(event.app_name)) {
      errors.push(`${prefix}.app_name is required when type is 'active'`);
    }
    if (!isNonEmptyString(event.window_title)) {
      errors.push(`${prefix}.window_title is required when type is 'active'`);
    }
  } else if (type === 'idle') {
    if (event.app_name !== undefined && event.app_name !== null) {
      errors.push(`${prefix}.app_name must be absent or null when type is 'idle'`);
    }
    if (event.window_title !== undefined && event.window_title !== null) {
      errors.push(`${prefix}.window_title must be absent or null when type is 'idle'`);
    }
  }

  if (errors.length > 0) {
    return { errors };
  }

  return {
    errors,
    row: {
      clientSegmentId: event.client_segment_id as string,
      type: type as SegmentType,
      appName: type === 'active' ? (event.app_name as string) : null,
      windowTitle:
        type === 'active'
          ? redactWindowTitle(event.window_title as string, event.app_name as string)
          : null,
      startedAt: new Date(event.started_at as string),
      endedAt: new Date(event.ended_at as string),
      durationSeconds: event.duration_seconds as number,
    },
  };
}

eventsRouter.post('/', requireDeviceAuth, async (req, res) => {
  const device = req.device!;
  const { agent_status, events } = req.body ?? {};

  const bodyErrors: string[] = [];
  if (agent_status !== 'running' && agent_status !== 'paused') {
    bodyErrors.push("agent_status must be 'running' or 'paused'");
  }
  if (!Array.isArray(events)) {
    bodyErrors.push('events must be an array');
  }
  if (bodyErrors.length > 0) {
    res.status(400).json({ error: 'Invalid request body', details: bodyErrors });
    return;
  }

  const eventErrors: string[] = [];
  const rows: ValidatedRow[] = [];
  (events as unknown[]).forEach((raw, index) => {
    const { errors, row } = validateEvent(raw, index);
    if (errors.length > 0) {
      eventErrors.push(...errors);
    } else if (row) {
      rows.push(row);
    }
  });

  if (eventErrors.length > 0) {
    res.status(400).json({ error: 'Invalid event(s)', details: eventErrors });
    return;
  }

  const { accepted, duplicates } = await prisma.$transaction(async (tx) => {
    let insertedCount = 0;
    if (rows.length > 0) {
      const result = await tx.activitySegment.createMany({
        data: rows.map((row) => ({ ...row, deviceId: device.id })),
        skipDuplicates: true,
      });
      insertedCount = result.count;
    }

    await tx.device.update({
      where: { id: device.id },
      data: { agentStatus: agent_status, lastSeenAt: new Date() },
    });

    return { accepted: insertedCount, duplicates: rows.length - insertedCount };
  });

  res.status(202).json({ accepted, duplicates });
});
