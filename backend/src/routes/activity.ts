import { Router } from 'express';
import { prisma } from '../db';
import { requireAdminAuth } from '../middleware/auth';

export const activityRouter = Router();

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

// No device_id filter here, unlike stats/top-apps: the locked API contract
// only specifies `?limit` for this endpoint. Not added speculatively.
activityRouter.get('/recent', requireAdminAuth, async (req, res) => {
  const limitParam = req.query.limit;
  let limit = DEFAULT_LIMIT;

  if (limitParam !== undefined) {
    const parsed = Number(limitParam);
    if (!Number.isInteger(parsed) || parsed < 1) {
      res.status(400).json({ error: 'limit must be a positive integer' });
      return;
    }
    limit = Math.min(parsed, MAX_LIMIT);
  }

  const segments = await prisma.activitySegment.findMany({
    orderBy: { startedAt: 'desc' },
    take: limit,
    include: { device: { select: { deviceName: true } } },
  });

  res.json(
    segments.map((segment) => ({
      device_name: segment.device.deviceName,
      type: segment.type,
      app_name: segment.appName,
      window_title: segment.windowTitle,
      started_at: segment.startedAt,
      ended_at: segment.endedAt,
      duration_seconds: segment.durationSeconds,
    })),
  );
});
