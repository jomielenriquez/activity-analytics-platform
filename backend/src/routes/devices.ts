import { randomBytes } from 'crypto';
import { Router, type Response } from 'express';
import type { Device } from '@prisma/client';
import { prisma } from '../db';
import { hashApiKey, requireAdminAuth } from '../middleware/auth';
import { isNonEmptyString, isUuid } from '../validation';
import { deriveDeviceStatus } from '../lib/deviceStatus';
import { buildStartedAtFilter, parseDateRangeQuery } from '../lib/dateRange';

export const devicesRouter = Router();

function serializeDevice(device: Device) {
  return {
    id: device.id,
    device_name: device.deviceName,
    os: device.os,
    user_identifier: device.userIdentifier,
    last_seen_at: device.lastSeenAt,
    status: deriveDeviceStatus(device),
    state_duration_seconds: device.stateDurationSeconds,
  };
}

// Shared by GET /:id and GET /:id/timeline: a malformed id can never match
// a real device either way, so it's treated the same as "not found" rather
// than a separate 400 case. Writes the 404 response itself and returns
// null so callers can just `if (!device) return;`.
async function findDeviceOrRespond404(id: unknown, res: Response): Promise<Device | null> {
  if (!isUuid(id)) {
    res.status(404).json({ error: 'Device not found' });
    return null;
  }

  const device = await prisma.device.findUnique({ where: { id } });
  if (!device) {
    res.status(404).json({ error: 'Device not found' });
    return null;
  }

  return device;
}

// No dedup by device_name: every call creates a new device row, even if the
// name matches an existing one. Known limitation, documented in the README
// rather than solved here.
devicesRouter.post('/register', async (req, res) => {
  const { device_name, os, user_identifier } = req.body ?? {};

  const fields = { device_name, os, user_identifier };
  const invalidFields = Object.entries(fields)
    .filter(([, value]) => !isNonEmptyString(value))
    .map(([key]) => key);
  if (invalidFields.length > 0) {
    res.status(400).json({
      error: `device_name, os, and user_identifier are required non-empty strings. Missing or invalid: ${invalidFields.join(', ')}`,
    });
    return;
  }

  const apiKey = randomBytes(32).toString('hex');

  const device = await prisma.device.create({
    data: {
      deviceName: device_name,
      os,
      userIdentifier: user_identifier,
      apiKeyHash: hashApiKey(apiKey),
      agentStatus: 'running',
      lastSeenAt: null,
    },
  });

  // The raw key is returned exactly once, here — only its hash is stored.
  res.status(201).json({ device_id: device.id, api_key: apiKey });
});

devicesRouter.get('/', requireAdminAuth, async (req, res) => {
  const devices = await prisma.device.findMany({
    orderBy: { lastSeenAt: { sort: 'desc', nulls: 'last' } },
  });

  res.json(devices.map((device) => serializeDevice(device)));
});

devicesRouter.get('/:id', requireAdminAuth, async (req, res) => {
  const device = await findDeviceOrRespond404(req.params.id, res);
  if (!device) {
    return;
  }

  res.json({
    ...serializeDevice(device),
    created_at: device.createdAt,
  });
});

// Chronological (ascending), unlike activity/recent's descending "feed"
// order — a timeline is meant to be read left-to-right as a sequence of
// what happened, not as a most-recent-first log.
devicesRouter.get('/:id/timeline', requireAdminAuth, async (req, res) => {
  const device = await findDeviceOrRespond404(req.params.id, res);
  if (!device) {
    return;
  }

  const { errors, from, to } = parseDateRangeQuery(req.query as Record<string, unknown>);
  if (errors.length > 0) {
    res.status(400).json({ error: 'Invalid query parameters', details: errors });
    return;
  }

  const startedAt = buildStartedAtFilter(from, to);

  // No limit/pagination this pass — a single device's segment history is
  // bounded enough for take-home scope. If force-flushing (see
  // SEGMENT_MAX_DURATION_SECONDS in DESIGN.md's known limitations) pushed
  // row counts up over a long retention period, this would need one too.
  const segments = await prisma.activitySegment.findMany({
    where: { deviceId: device.id, ...(startedAt ? { startedAt } : {}) },
    orderBy: { startedAt: 'asc' },
  });

  res.json(
    segments.map((segment) => ({
      client_segment_id: segment.clientSegmentId,
      type: segment.type,
      app_name: segment.appName,
      window_title: segment.windowTitle,
      started_at: segment.startedAt,
      ended_at: segment.endedAt,
      duration_seconds: segment.durationSeconds,
    })),
  );
});
