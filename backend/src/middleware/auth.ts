import { createHash, timingSafeEqual } from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import type { Device } from '@prisma/client';
import { prisma } from '../db';

declare global {
  namespace Express {
    interface Request {
      device?: Device;
    }
  }
}

// Deterministic (not salted) on purpose: device API keys are high-entropy
// random tokens, not user-chosen passwords, so there's no dictionary-attack
// risk, and a deterministic hash lets us look the device up directly by
// `WHERE api_key_hash = ?` instead of scanning every row to compare.
export function hashApiKey(rawKey: string): string {
  return createHash('sha256').update(rawKey).digest('hex');
}

function extractBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return null;
  }
  const token = header.slice('Bearer '.length).trim();
  return token.length > 0 ? token : null;
}

export async function requireDeviceAuth(req: Request, res: Response, next: NextFunction) {
  const rawKey = extractBearerToken(req);
  if (!rawKey) {
    res.status(401).json({ error: 'Missing or malformed Authorization header' });
    return;
  }

  const device = await prisma.device.findFirst({
    where: { apiKeyHash: hashApiKey(rawKey) },
  });
  if (!device) {
    res.status(401).json({ error: 'Invalid device API key' });
    return;
  }

  req.device = device;
  next();
}

export function requireAdminAuth(req: Request, res: Response, next: NextFunction) {
  const rawKey = extractBearerToken(req);
  if (!rawKey) {
    res.status(401).json({ error: 'Missing or malformed Authorization header' });
    return;
  }

  const expected = Buffer.from(process.env.ADMIN_API_KEY as string);
  const provided = Buffer.from(rawKey);
  const isValid = expected.length === provided.length && timingSafeEqual(expected, provided);
  if (!isValid) {
    res.status(401).json({ error: 'Invalid admin API key' });
    return;
  }

  next();
}
