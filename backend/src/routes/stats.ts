import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { requireAdminAuth } from '../middleware/auth';
import { isUuid } from '../validation';
import { parseDateRangeQuery } from '../lib/dateRange';
import { deriveDeviceStatus, getLatestSegmentTypeByDevice } from '../lib/deviceStatus';

export const statsRouter = Router();

function buildStartedAtFilter(from?: Date, to?: Date): Prisma.DateTimeFilter | undefined {
  if (!from && !to) {
    return undefined;
  }
  return { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
}

statsRouter.get('/summary', requireAdminAuth, async (req, res) => {
  const { errors, from, to } = parseDateRangeQuery(req.query as Record<string, unknown>);
  if (errors.length > 0) {
    res.status(400).json({ error: 'Invalid query parameters', details: errors });
    return;
  }

  const startedAt = buildStartedAtFilter(from, to);

  const [durationsByType, devices, latestTypeByDevice] = await Promise.all([
    prisma.activitySegment.groupBy({
      by: ['type'],
      where: startedAt ? { startedAt } : undefined,
      _sum: { durationSeconds: true },
    }),
    prisma.device.findMany({ select: { id: true, lastSeenAt: true, agentStatus: true } }),
    getLatestSegmentTypeByDevice(),
  ]);

  const totalsByType = new Map(durationsByType.map((row) => [row.type, row._sum.durationSeconds ?? 0]));

  // active_device_count means devices that are online *right now* (derived
  // status !== 'offline', same logic as GET /devices), NOT devices that had
  // activity within [from, to]. Those are genuinely different questions —
  // "who's online" vs. "who was active in this window" — and "active" is
  // ambiguous between them. This endpoint answers the former; from/to only
  // scopes the duration totals below, not this count.
  const activeDeviceCount = devices.filter(
    (device) => deriveDeviceStatus(device, latestTypeByDevice.get(device.id) ?? null) !== 'offline',
  ).length;

  res.json({
    active_device_count: activeDeviceCount,
    total_active_seconds: totalsByType.get('active') ?? 0,
    total_idle_seconds: totalsByType.get('idle') ?? 0,
  });
});

const TOP_APPS_LIMIT = 20;

statsRouter.get('/top-apps', requireAdminAuth, async (req, res) => {
  const { errors, from, to } = parseDateRangeQuery(req.query as Record<string, unknown>);

  const deviceId = req.query.device_id;
  if (deviceId !== undefined && !isUuid(deviceId)) {
    errors.push('device_id must be a UUID string');
  }

  if (errors.length > 0) {
    res.status(400).json({ error: 'Invalid query parameters', details: errors });
    return;
  }

  const startedAt = buildStartedAtFilter(from, to);

  const rows = await prisma.activitySegment.groupBy({
    by: ['appName'],
    where: {
      type: 'active', // excludes idle segments, whose app_name is always null
      ...(deviceId ? { deviceId: deviceId as string } : {}),
      ...(startedAt ? { startedAt } : {}),
    },
    _sum: { durationSeconds: true },
    orderBy: { _sum: { durationSeconds: 'desc' } },
    take: TOP_APPS_LIMIT,
  });

  res.json(
    rows.map((row) => ({
      app_name: row.appName,
      total_seconds: row._sum.durationSeconds ?? 0,
    })),
  );
});
