import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../app';
import { prisma } from '../db';

function adminAuthHeader() {
  return { Authorization: `Bearer ${process.env.ADMIN_API_KEY}` };
}

describe('GET /api/v1/stats/summary', () => {
  let deviceId: string;
  let apiKey: string;

  beforeAll(async () => {
    const res = await request(app).post('/api/v1/devices/register').send({
      device_name: 'STATS-SUMMARY-VITEST',
      os: 'windows',
      user_identifier: 'vitest',
    });
    expect(res.status).toBe(201);
    deviceId = res.body.device_id;
    apiKey = res.body.api_key;
  });

  afterAll(async () => {
    await prisma.activitySegment.deleteMany({ where: { deviceId } });
    await prisma.device.delete({ where: { id: deviceId } });
    await prisma.$disconnect();
  });

  it('rejects a request with no admin Authorization header', async () => {
    const res = await request(app).get('/api/v1/stats/summary');
    expect(res.status).toBe(401);
  });

  it('rejects a malformed from/to date', async () => {
    const res = await request(app).get('/api/v1/stats/summary?from=not-a-date').set(adminAuthHeader());
    expect(res.status).toBe(400);
  });

  // active_device_count reflects devices online *right now*, which is
  // independent of any date range — asserted as a before/after delta
  // (rather than an absolute value) so this isn't flaky if other devices
  // exist in the database from other test files running concurrently.
  it('active_device_count increases by 1 when a device heartbeats, independent of date range', async () => {
    const before = await request(app).get('/api/v1/stats/summary').set(adminAuthHeader());
    expect(before.status).toBe(200);

    const eventsRes = await request(app)
      .post('/api/v1/events')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({ agent_status: 'running', events: [] });
    expect(eventsRes.status).toBe(202);

    const after = await request(app).get('/api/v1/stats/summary').set(adminAuthHeader());
    expect(after.status).toBe(200);
    expect(after.body.active_device_count).toBe(before.body.active_device_count + 1);
  });

  // Uses a dedicated far-future date range (2031) that nothing else in the
  // suite touches, so the sums below are exact rather than an inequality —
  // safe even if other test files insert segments concurrently.
  it('sums total_active_seconds/total_idle_seconds within the range, excluding segments outside it', async () => {
    const insideActive = new Date('2031-01-01T10:00:00Z');
    const insideIdle = new Date('2031-01-01T12:00:00Z');
    const outsideActive = new Date('2031-06-01T00:00:00Z');

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
            window_title: 'In Range',
            started_at: insideActive.toISOString(),
            ended_at: new Date(insideActive.getTime() + 100_000).toISOString(),
            duration_seconds: 100,
          },
          {
            client_segment_id: randomUUID(),
            type: 'idle',
            started_at: insideIdle.toISOString(),
            ended_at: new Date(insideIdle.getTime() + 40_000).toISOString(),
            duration_seconds: 40,
          },
          {
            client_segment_id: randomUUID(),
            type: 'active',
            app_name: 'notepad.exe',
            window_title: 'Outside Range',
            started_at: outsideActive.toISOString(),
            ended_at: new Date(outsideActive.getTime() + 999_000).toISOString(),
            duration_seconds: 999,
          },
        ],
      });
    expect(eventsRes.status).toBe(202);

    const res = await request(app)
      .get('/api/v1/stats/summary?from=2031-01-01T00:00:00Z&to=2031-01-02T00:00:00Z')
      .set(adminAuthHeader());

    expect(res.status).toBe(200);
    expect(res.body.total_active_seconds).toBe(100);
    expect(res.body.total_idle_seconds).toBe(40);
  });

  it('covers all-time when from/to are omitted', async () => {
    const res = await request(app).get('/api/v1/stats/summary').set(adminAuthHeader());
    expect(res.status).toBe(200);
    // The 999s segment from the prior test falls outside that test's range
    // but must still count when no range is given at all.
    expect(res.body.total_active_seconds).toBeGreaterThanOrEqual(999);
  });
});

describe('GET /api/v1/stats/top-apps', () => {
  let deviceA: { deviceId: string; apiKey: string };
  let deviceB: { deviceId: string; apiKey: string };

  const RANGE_FROM = '2032-01-01T00:00:00Z';
  const RANGE_TO = '2032-01-02T00:00:00Z';
  const rangeBase = new Date(RANGE_FROM).getTime();
  const outsideRange = new Date(rangeBase + 10 * 24 * 3600_000); // +10 days

  beforeAll(async () => {
    const resA = await request(app).post('/api/v1/devices/register').send({
      device_name: 'TOP-APPS-A',
      os: 'windows',
      user_identifier: 'vitest',
    });
    deviceA = { deviceId: resA.body.device_id, apiKey: resA.body.api_key };

    const resB = await request(app).post('/api/v1/devices/register').send({
      device_name: 'TOP-APPS-B',
      os: 'windows',
      user_identifier: 'vitest',
    });
    deviceB = { deviceId: resB.body.device_id, apiKey: resB.body.api_key };

    // Device A: chrome.exe 500s (in range), notepad.exe 100s (in range),
    // an idle segment (excluded regardless of range), chrome.exe 50s
    // 10 days later (outside range).
    const eventsA = await request(app)
      .post('/api/v1/events')
      .set('Authorization', `Bearer ${deviceA.apiKey}`)
      .send({
        agent_status: 'running',
        events: [
          {
            client_segment_id: randomUUID(),
            type: 'active',
            app_name: 'chrome.exe',
            window_title: 't',
            started_at: new Date(rangeBase).toISOString(),
            ended_at: new Date(rangeBase + 500_000).toISOString(),
            duration_seconds: 500,
          },
          {
            client_segment_id: randomUUID(),
            type: 'active',
            app_name: 'notepad.exe',
            window_title: 't',
            started_at: new Date(rangeBase + 1_000).toISOString(),
            ended_at: new Date(rangeBase + 101_000).toISOString(),
            duration_seconds: 100,
          },
          {
            client_segment_id: randomUUID(),
            type: 'idle',
            started_at: new Date(rangeBase + 2_000).toISOString(),
            ended_at: new Date(rangeBase + 12_000).toISOString(),
            duration_seconds: 10,
          },
          {
            client_segment_id: randomUUID(),
            type: 'active',
            app_name: 'chrome.exe',
            window_title: 'outside',
            started_at: outsideRange.toISOString(),
            ended_at: new Date(outsideRange.getTime() + 50_000).toISOString(),
            duration_seconds: 50,
          },
        ],
      });
    expect(eventsA.status).toBe(202);

    // Device B: chrome.exe 20s (in range).
    const eventsB = await request(app)
      .post('/api/v1/events')
      .set('Authorization', `Bearer ${deviceB.apiKey}`)
      .send({
        agent_status: 'running',
        events: [
          {
            client_segment_id: randomUUID(),
            type: 'active',
            app_name: 'chrome.exe',
            window_title: 't',
            started_at: new Date(rangeBase + 3_000).toISOString(),
            ended_at: new Date(rangeBase + 23_000).toISOString(),
            duration_seconds: 20,
          },
        ],
      });
    expect(eventsB.status).toBe(202);
  });

  afterAll(async () => {
    const ids = [deviceA.deviceId, deviceB.deviceId];
    await prisma.activitySegment.deleteMany({ where: { deviceId: { in: ids } } });
    await prisma.device.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  });

  it('rejects a request with no admin Authorization header', async () => {
    const res = await request(app).get('/api/v1/stats/top-apps');
    expect(res.status).toBe(401);
  });

  it('rejects a malformed device_id', async () => {
    const res = await request(app)
      .get('/api/v1/stats/top-apps?device_id=not-a-uuid')
      .set(adminAuthHeader());
    expect(res.status).toBe(400);
  });

  it('rejects a malformed from date', async () => {
    const res = await request(app)
      .get('/api/v1/stats/top-apps?from=not-a-date')
      .set(adminAuthHeader());
    expect(res.status).toBe(400);
  });

  it('groups by app_name within the range, excludes idle and out-of-range segments, orders descending', async () => {
    const res = await request(app)
      .get(`/api/v1/stats/top-apps?from=${RANGE_FROM}&to=${RANGE_TO}`)
      .set(adminAuthHeader());

    expect(res.status).toBe(200);

    const chrome = res.body.find((r: { app_name: string }) => r.app_name === 'chrome.exe');
    const notepad = res.body.find((r: { app_name: string }) => r.app_name === 'notepad.exe');

    // 500 (device A, in range) + 20 (device B, in range); excludes the
    // +10-day chrome.exe (50s, out of range) and the idle segment (10s).
    expect(chrome.total_seconds).toBe(520);
    expect(notepad.total_seconds).toBe(100);
    expect(res.body.indexOf(chrome)).toBeLessThan(res.body.indexOf(notepad));
  });

  it('filters by device_id', async () => {
    const res = await request(app)
      .get(`/api/v1/stats/top-apps?from=${RANGE_FROM}&to=${RANGE_TO}&device_id=${deviceB.deviceId}`)
      .set(adminAuthHeader());

    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ app_name: 'chrome.exe', total_seconds: 20 }]);
  });
});
