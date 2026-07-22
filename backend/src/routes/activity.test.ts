import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../app';
import { prisma } from '../db';

function adminAuthHeader() {
  return { Authorization: `Bearer ${process.env.ADMIN_API_KEY}` };
}

describe('GET /api/v1/activity/recent', () => {
  let deviceId: string;

  // Far-future, densely-packed timestamps guaranteed to be the most recent
  // rows in the whole table (nothing else in the suite uses 2030+ dates),
  // so "most recent N" queries against the full table are deterministic
  // regardless of what other test files insert concurrently.
  const baseTime = new Date('2030-01-01T00:00:00Z').getTime();
  const SEED_COUNT = 201;

  beforeAll(async () => {
    const registerRes = await request(app).post('/api/v1/devices/register').send({
      device_name: 'RECENT-VITEST',
      os: 'windows',
      user_identifier: 'vitest',
    });
    expect(registerRes.status).toBe(201);
    deviceId = registerRes.body.device_id;
    const apiKey = registerRes.body.api_key;

    const events = Array.from({ length: SEED_COUNT }, (_, i) => ({
      client_segment_id: randomUUID(),
      type: 'idle' as const,
      started_at: new Date(baseTime + i * 1_000).toISOString(),
      ended_at: new Date(baseTime + i * 1_000 + 500).toISOString(),
      duration_seconds: 1,
    }));

    const res = await request(app)
      .post('/api/v1/events')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({ agent_status: 'running', current_state: 'idle', state_duration_seconds: 0, events });

    expect(res.status).toBe(202);
    expect(res.body.accepted).toBe(SEED_COUNT);
  });

  afterAll(async () => {
    await prisma.activitySegment.deleteMany({ where: { deviceId } });
    await prisma.device.delete({ where: { id: deviceId } });
    await prisma.$disconnect();
  });

  it('rejects a request with no admin Authorization header', async () => {
    const res = await request(app).get('/api/v1/activity/recent');
    expect(res.status).toBe(401);
  });

  it('caps the result at 200 even when a much higher limit is requested', async () => {
    const res = await request(app).get('/api/v1/activity/recent?limit=1000').set(adminAuthHeader());

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(200);

    // The single oldest of our 201 seeded rows must have been dropped by
    // the cap, since ordering is most-recent-first.
    const oldestStartedAt = new Date(baseTime).toISOString();
    expect(res.body.some((s: { started_at: string }) => s.started_at === oldestStartedAt)).toBe(false);
  });

  it('defaults to a limit of 50 when limit is omitted', async () => {
    const res = await request(app).get('/api/v1/activity/recent').set(adminAuthHeader());

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(50);
  });

  it('orders results by started_at descending', async () => {
    const res = await request(app).get('/api/v1/activity/recent?limit=5').set(adminAuthHeader());

    expect(res.status).toBe(200);
    const timestamps = res.body.map((s: { started_at: string }) => new Date(s.started_at).getTime());
    const sortedDesc = [...timestamps].sort((a, b) => b - a);
    expect(timestamps).toEqual(sortedDesc);
  });

  it('includes the joined device_name and the expected segment fields', async () => {
    const res = await request(app).get('/api/v1/activity/recent?limit=1').set(adminAuthHeader());

    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({ device_name: 'RECENT-VITEST', type: 'idle' });
    expect(res.body[0]).toHaveProperty('app_name');
    expect(res.body[0]).toHaveProperty('window_title');
    expect(res.body[0]).toHaveProperty('started_at');
    expect(res.body[0]).toHaveProperty('ended_at');
    expect(res.body[0]).toHaveProperty('duration_seconds');
  });

  it('rejects a non-integer limit', async () => {
    const res = await request(app).get('/api/v1/activity/recent?limit=abc').set(adminAuthHeader());
    expect(res.status).toBe(400);
  });

  it('rejects a zero limit', async () => {
    const res = await request(app).get('/api/v1/activity/recent?limit=0').set(adminAuthHeader());
    expect(res.status).toBe(400);
  });

  it('rejects a negative limit', async () => {
    const res = await request(app).get('/api/v1/activity/recent?limit=-5').set(adminAuthHeader());
    expect(res.status).toBe(400);
  });
});
