import { randomBytes } from 'crypto';
import { Router } from 'express';
import type { Device, SegmentType } from '@prisma/client';
import { prisma } from '../db';
import { hashApiKey, requireAdminAuth } from '../middleware/auth';
import { isNonEmptyString, isUuid } from '../validation';
import { deriveDeviceStatus, getLatestSegmentTypeByDevice } from '../lib/deviceStatus';

export const devicesRouter = Router();

function serializeDevice(device: Device, latestSegmentType: SegmentType | null) {
  return {
    id: device.id,
    device_name: device.deviceName,
    os: device.os,
    user_identifier: device.userIdentifier,
    last_seen_at: device.lastSeenAt,
    status: deriveDeviceStatus(device, latestSegmentType),
  };
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
  const [devices, latestTypeByDevice] = await Promise.all([
    prisma.device.findMany({
      orderBy: { lastSeenAt: { sort: 'desc', nulls: 'last' } },
    }),
    getLatestSegmentTypeByDevice(),
  ]);

  res.json(devices.map((device) => serializeDevice(device, latestTypeByDevice.get(device.id) ?? null)));
});

devicesRouter.get('/:id', requireAdminAuth, async (req, res) => {
  // A malformed id can never match a real device either way, so treat it
  // the same as "not found" rather than a separate 400 case.
  if (!isUuid(req.params.id)) {
    res.status(404).json({ error: 'Device not found' });
    return;
  }

  const device = await prisma.device.findUnique({ where: { id: req.params.id } });
  if (!device) {
    res.status(404).json({ error: 'Device not found' });
    return;
  }

  const latestSegment = await prisma.activitySegment.findFirst({
    where: { deviceId: device.id },
    orderBy: { startedAt: 'desc' },
    select: { type: true },
  });

  res.json({
    ...serializeDevice(device, latestSegment?.type ?? null),
    created_at: device.createdAt,
  });
});
