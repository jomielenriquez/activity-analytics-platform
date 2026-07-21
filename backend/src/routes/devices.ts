import { randomBytes } from 'crypto';
import { Router } from 'express';
import { prisma } from '../db';
import { hashApiKey } from '../middleware/auth';
import { isNonEmptyString } from '../validation';

export const devicesRouter = Router();

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
