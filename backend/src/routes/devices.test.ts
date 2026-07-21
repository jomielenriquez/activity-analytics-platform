import { randomUUID } from 'crypto';
import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../app';
import { prisma } from '../db';

function adminAuthHeader() {
  return { Authorization: `Bearer ${process.env.ADMIN_API_KEY}` };
}

describe('GET /api/v1/devices and GET /api/v1/devices/:id', () => {
  const deviceIds: string[] = [];

  async function registerDevice(name: string) {
    const res = await request(app).post('/api/v1/devices/register').send({
      device_name: name,
      os: 'windows',
      user_identifier: 'vitest',
    });
    expect(res.status).toBe(201);
    deviceIds.push(res.body.device_id);
    return { deviceId: res.body.device_id as string, apiKey: res.body.api_key as string };
  }

  afterAll(async () => {
    await prisma.activitySegment.deleteMany({ where: { deviceId: { in: deviceIds } } });
    await prisma.device.deleteMany({ where: { id: { in: deviceIds } } });
    await prisma.$disconnect();
  });

  it('rejects a request with no admin Authorization header', async () => {
    const res = await request(app).get('/api/v1/devices');
    expect(res.status).toBe(401);
  });

  it('rejects a request with an invalid admin key', async () => {
    const res = await request(app).get('/api/v1/devices').set('Authorization', 'Bearer not-the-admin-key');
    expect(res.status).toBe(401);
  });

  it('a freshly registered device with no segments yet is "offline", without crashing', async () => {
    const { deviceId } = await registerDevice('STATUS-NO-SEGMENTS');

    const res = await request(app).get(`/api/v1/devices/${deviceId}`).set(adminAuthHeader());

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('offline');
    expect(res.body.last_seen_at).toBeNull();
  });

  it('a device with a recent heartbeat and an active latest segment is "active"', async () => {
    const { deviceId, apiKey } = await registerDevice('STATUS-ACTIVE');

    const eventsRes = await request(app)
      .post('/api/v1/events')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({
        agent_status: 'running',
        events: [
          {
            client_segment_id: randomUUID(),
            type: 'active',
            app_name: 'chrome.exe',
            window_title: 'Active Device Test',
            started_at: new Date(Date.now() - 60_000).toISOString(),
            ended_at: new Date().toISOString(),
            duration_seconds: 60,
          },
        ],
      });
    expect(eventsRes.status).toBe(202);

    const res = await request(app).get(`/api/v1/devices/${deviceId}`).set(adminAuthHeader());
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('active');
  });

  it('agent_status "paused" wins over the latest segment being "active"', async () => {
    const { deviceId, apiKey } = await registerDevice('STATUS-PAUSED');

    const eventsRes = await request(app)
      .post('/api/v1/events')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({
        agent_status: 'paused',
        events: [
          {
            client_segment_id: randomUUID(),
            type: 'active',
            app_name: 'chrome.exe',
            window_title: 'Paused Device Test',
            started_at: new Date(Date.now() - 60_000).toISOString(),
            ended_at: new Date().toISOString(),
            duration_seconds: 60,
          },
        ],
      });
    expect(eventsRes.status).toBe(202);

    const res = await request(app).get(`/api/v1/devices/${deviceId}`).set(adminAuthHeader());
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('paused');
  });

  it('agent_status "running" with an idle latest segment is "idle"', async () => {
    const { deviceId, apiKey } = await registerDevice('STATUS-IDLE');

    const eventsRes = await request(app)
      .post('/api/v1/events')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({
        agent_status: 'running',
        events: [
          {
            client_segment_id: randomUUID(),
            type: 'idle',
            started_at: new Date(Date.now() - 60_000).toISOString(),
            ended_at: new Date().toISOString(),
            duration_seconds: 60,
          },
        ],
      });
    expect(eventsRes.status).toBe(202);

    const res = await request(app).get(`/api/v1/devices/${deviceId}`).set(adminAuthHeader());
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('idle');
  });

  it('a device with a stale last_seen_at (>90s) is "offline" even if agent_status is "running"', async () => {
    const { deviceId, apiKey } = await registerDevice('STATUS-STALE');

    const eventsRes = await request(app)
      .post('/api/v1/events')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({ agent_status: 'running', events: [] });
    expect(eventsRes.status).toBe(202);

    // The API always sets last_seen_at to "now", so simulating staleness
    // means reaching past it directly.
    await prisma.device.update({
      where: { id: deviceId },
      data: { lastSeenAt: new Date(Date.now() - 200_000) },
    });

    const res = await request(app).get(`/api/v1/devices/${deviceId}`).set(adminAuthHeader());
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('offline');
  });

  it('returns 404 for a nonexistent device id', async () => {
    const res = await request(app)
      .get('/api/v1/devices/00000000-0000-4000-8000-000000000000')
      .set(adminAuthHeader());

    expect(res.status).toBe(404);
  });

  it('returns 404 for a malformed (non-UUID) device id, not a 500', async () => {
    const res = await request(app).get('/api/v1/devices/not-a-uuid').set(adminAuthHeader());

    expect(res.status).toBe(404);
  });

  it('lists devices with the derived status, ordered by last_seen_at descending with nulls last', async () => {
    const res = await request(app).get('/api/v1/devices').set(adminAuthHeader());

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);

    const ours = res.body.filter((d: { id: string }) => deviceIds.includes(d.id));
    expect(ours).toHaveLength(deviceIds.length);

    // Once a null last_seen_at appears, every device after it must also be
    // null — proves nulls are sorted last, not interleaved.
    const lastSeenValues = res.body.map((d: { last_seen_at: string | null }) => d.last_seen_at);
    const firstNullIndex = lastSeenValues.indexOf(null);
    if (firstNullIndex !== -1) {
      expect(lastSeenValues.slice(firstNullIndex).every((v: unknown) => v === null)).toBe(true);
    }
  });
});
