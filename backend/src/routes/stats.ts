import { Router } from 'express';
import { Prisma } from '@prisma/client';
import type { SegmentType } from '@prisma/client';
import { prisma } from '../db';
import { requireAdminAuth } from '../middleware/auth';
import { isUuid } from '../validation';
import { buildStartedAtFilter, parseDateRangeQuery } from '../lib/dateRange';
import { deriveDeviceStatus, getLatestSegmentTypeByDevice } from '../lib/deviceStatus';

export const statsRouter = Router();

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

const BUCKET_VALUES = ['hour', 'day'] as const;
type Bucket = (typeof BUCKET_VALUES)[number];

function isValidBucket(value: unknown): value is Bucket {
  return value === 'hour' || value === 'day';
}

interface ActivityOverTimeRow {
  bucket_start: Date;
  type: SegmentType;
  total_seconds: number;
}

statsRouter.get('/activity-over-time', requireAdminAuth, async (req, res) => {
  const errors: string[] = [];

  const bucket = req.query.bucket;
  if (!isValidBucket(bucket)) {
    errors.push("bucket is required and must be 'hour' or 'day'");
  }

  const { errors: dateErrors, from, to } = parseDateRangeQuery(req.query as Record<string, unknown>);
  errors.push(...dateErrors);

  const deviceId = req.query.device_id;
  if (deviceId !== undefined && !isUuid(deviceId)) {
    errors.push('device_id must be a UUID string');
  }

  if (errors.length > 0) {
    res.status(400).json({ error: 'Invalid query parameters', details: errors });
    return;
  }

  // device_id filters results but never 404s, even for a well-formed id
  // that doesn't match any device: this is an aggregation endpoint, not a
  // resource lookup, so a non-matching filter is just an empty result set,
  // same as top-apps' device_id handling.
  const conditions: Prisma.Sql[] = [];
  if (deviceId) {
    conditions.push(Prisma.sql`device_id = ${deviceId as string}::uuid`);
  }
  if (from) {
    conditions.push(Prisma.sql`started_at >= ${from}`);
  }
  if (to) {
    conditions.push(Prisma.sql`started_at <= ${to}`);
  }
  const whereClause =
    conditions.length > 0 ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}` : Prisma.empty;

  // A segment is attributed entirely to the bucket containing its
  // started_at — a deliberate simplification, not an oversight. No
  // proportional splitting across a bucket boundary even when a segment
  // spans one (e.g. a segment starting at 10:58 and ending at 11:03 counts
  // fully in the 10:00 hour bucket, none of it in 11:00). Splitting would
  // mean re-deriving partial durations per bucket instead of trusting the
  // stored duration_seconds directly — real complexity for a take-home.
  // Documented in DESIGN.md's known limitations.
  const rows = await prisma.$queryRaw<ActivityOverTimeRow[]>`
    SELECT
      date_trunc(${bucket as Bucket}, started_at) AS bucket_start,
      type,
      SUM(duration_seconds)::int AS total_seconds
    FROM activity_segments
    ${whereClause}
    GROUP BY bucket_start, type
    ORDER BY bucket_start ASC
  `;

  const bucketsByStart = new Map<
    number,
    { bucket_start: Date; active_seconds: number; idle_seconds: number }
  >();
  for (const row of rows) {
    const key = row.bucket_start.getTime();
    let entry = bucketsByStart.get(key);
    if (!entry) {
      entry = { bucket_start: row.bucket_start, active_seconds: 0, idle_seconds: 0 };
      bucketsByStart.set(key, entry);
    }
    if (row.type === 'active') {
      entry.active_seconds = row.total_seconds;
    } else {
      entry.idle_seconds = row.total_seconds;
    }
  }

  // No zero-filled buckets: a bucket only appears here if it has at least
  // one segment. Backfilling empty buckets would need a bucket sequence
  // independent of the data (awkward when from/to are omitted entirely —
  // all-time has no natural start), and would silently balloon the
  // response for any sparse range (e.g. day-bucketed over a year with
  // activity on 10 days would otherwise return 355 zero rows). The
  // dashboard's chart needs to render this as real gaps on the x-axis, not
  // assume a dense, continuous series.
  const buckets = Array.from(bucketsByStart.values()).sort(
    (a, b) => a.bucket_start.getTime() - b.bucket_start.getTime(),
  );

  res.json(buckets);
});
