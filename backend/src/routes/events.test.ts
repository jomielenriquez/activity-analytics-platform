import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../app';
import { prisma } from '../db';

// Integration suite: hits a real Postgres via Prisma, same as
// verify-events.ps1 did through `docker compose exec postgres psql`. A
// device is registered for real through the API in beforeAll instead of
// taking an -ApiKey param, so the suite is self-contained. Scenarios below
// mirror verify-events.ps1 1:1, including the ordering dependency between
// [2]/[3]/[4]/[10] on the same client_segment_id (idA) — same as the script,
// this is not test-isolated by design, since dedup/first-write-wins are
// exactly what's under test.
describe('POST /api/v1/events', () => {
  let apiKey: string;
  let deviceId: string;
  let idA: string;
  let idB: string;

  beforeAll(async () => {
    const res = await request(app).post('/api/v1/devices/register').send({
      device_name: 'EVENTS-VITEST',
      os: 'windows',
      user_identifier: 'vitest',
    });
    expect(res.status).toBe(201);
    apiKey = res.body.api_key;
    deviceId = res.body.device_id;
  });

  afterAll(async () => {
    // FK is ON DELETE RESTRICT, so segments must go before the device.
    await prisma.activitySegment.deleteMany({ where: { deviceId } });
    await prisma.device.delete({ where: { id: deviceId } });
    await prisma.$disconnect();
  });

  it('[1] accepts a heartbeat-only tick with an empty events array', async () => {
    const res = await request(app)
      .post('/api/v1/events')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({ agent_status: 'running', current_state: 'active', state_duration_seconds: 0, events: [] });

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ accepted: 0, duplicates: 0 });
  });

  it('[2] accepts a valid active + idle segment batch', async () => {
    idA = randomUUID();
    idB = randomUUID();

    const res = await request(app)
      .post('/api/v1/events')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({
        agent_status: 'running',
        current_state: 'idle',
        state_duration_seconds: 0,
        events: [
          {
            client_segment_id: idA,
            type: 'active',
            app_name: 'chrome.exe',
            window_title: 'Verification Test',
            started_at: '2026-07-21T10:00:00Z',
            ended_at: '2026-07-21T10:05:00Z',
            duration_seconds: 300,
          },
          {
            client_segment_id: idB,
            type: 'idle',
            started_at: '2026-07-21T10:05:00Z',
            ended_at: '2026-07-21T10:10:00Z',
            duration_seconds: 300,
          },
        ],
      });

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ accepted: 2, duplicates: 0 });
  });

  it('[3] is idempotent on resend of an identical batch', async () => {
    const res = await request(app)
      .post('/api/v1/events')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({
        agent_status: 'running',
        current_state: 'idle',
        state_duration_seconds: 0,
        events: [
          {
            client_segment_id: idA,
            type: 'active',
            app_name: 'chrome.exe',
            window_title: 'Verification Test',
            started_at: '2026-07-21T10:00:00Z',
            ended_at: '2026-07-21T10:05:00Z',
            duration_seconds: 300,
          },
          {
            client_segment_id: idB,
            type: 'idle',
            started_at: '2026-07-21T10:05:00Z',
            ended_at: '2026-07-21T10:10:00Z',
            duration_seconds: 300,
          },
        ],
      });

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ accepted: 0, duplicates: 2 });

    const count = await prisma.activitySegment.count({ where: { clientSegmentId: idA } });
    expect(count).toBe(1);
  });

  it('[4] skips a conflicting resend (same client_segment_id, different duration) — first write wins', async () => {
    const res = await request(app)
      .post('/api/v1/events')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({
        agent_status: 'running',
        current_state: 'active',
        state_duration_seconds: 0,
        events: [
          {
            client_segment_id: idA,
            type: 'active',
            app_name: 'chrome.exe',
            window_title: 'Verification Test',
            started_at: '2026-07-21T10:00:00Z',
            ended_at: '2026-07-21T10:09:00Z',
            duration_seconds: 999,
          },
        ],
      });

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ accepted: 0, duplicates: 1 });

    const stored = await prisma.activitySegment.findFirst({ where: { clientSegmentId: idA } });
    expect(stored?.durationSeconds).toBe(300);
  });

  it('[5] atomically rejects a batch containing one valid and one invalid event', async () => {
    const idValid = randomUUID();
    const idInvalid = randomUUID();

    const res = await request(app)
      .post('/api/v1/events')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({
        agent_status: 'running',
        current_state: 'active',
        state_duration_seconds: 0,
        events: [
          {
            client_segment_id: idValid,
            type: 'active',
            app_name: 'chrome.exe',
            window_title: 'Should Not Be Inserted',
            started_at: '2026-07-21T11:00:00Z',
            ended_at: '2026-07-21T11:05:00Z',
            duration_seconds: 300,
          },
          {
            // missing app_name/window_title, required for type: active
            client_segment_id: idInvalid,
            type: 'active',
            started_at: '2026-07-21T11:05:00Z',
            ended_at: '2026-07-21T11:10:00Z',
            duration_seconds: 300,
          },
        ],
      });

    expect(res.status).toBe(400);

    const count = await prisma.activitySegment.count({ where: { clientSegmentId: idValid } });
    expect(count).toBe(0);
  });

  it('[6] rejects a request with no Authorization header', async () => {
    const res = await request(app).post('/api/v1/events').send({ agent_status: 'running', events: [] });

    expect(res.status).toBe(401);
  });

  it('[7] rejects a request with an invalid API key', async () => {
    const res = await request(app)
      .post('/api/v1/events')
      .set('Authorization', 'Bearer not-a-real-key')
      .send({ agent_status: 'running', events: [] });

    expect(res.status).toBe(401);
  });

  it('[8] rejects a malformed (non-UUID) client_segment_id with 400, not 500', async () => {
    const res = await request(app)
      .post('/api/v1/events')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({
        agent_status: 'running',
        current_state: 'idle',
        state_duration_seconds: 0,
        events: [
          {
            client_segment_id: 'not-a-uuid',
            type: 'idle',
            started_at: '2026-07-21T12:00:00Z',
            ended_at: '2026-07-21T12:05:00Z',
            duration_seconds: 300,
          },
        ],
      });

    expect(res.status).toBe(400);
  });

  it('[9] truncates window_title to 512 characters', async () => {
    const idTrunc = randomUUID();
    const longTitle = 'x'.repeat(600);

    const res = await request(app)
      .post('/api/v1/events')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({
        agent_status: 'running',
        current_state: 'active',
        state_duration_seconds: 0,
        events: [
          {
            client_segment_id: idTrunc,
            type: 'active',
            app_name: 'chrome.exe',
            window_title: longTitle,
            started_at: '2026-07-21T13:00:00Z',
            ended_at: '2026-07-21T13:05:00Z',
            duration_seconds: 300,
          },
        ],
      });

    expect(res.status).toBe(202);

    const stored = await prisma.activitySegment.findFirst({ where: { clientSegmentId: idTrunc } });
    expect(stored?.windowTitle).toHaveLength(512);
  });

  it('[10] updates agent_status and last_seen_at from a heartbeat-only tick', async () => {
    const before = new Date();

    const res = await request(app)
      .post('/api/v1/events')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({ agent_status: 'paused', current_state: 'active', state_duration_seconds: 0, events: [] });

    expect(res.status).toBe(202);

    const device = await prisma.device.findUnique({ where: { id: deviceId } });
    expect(device?.agentStatus).toBe('paused');
    // The original script's [10] only asserted agent_status despite its
    // title also covering last_seen_at — closing that gap here, since
    // "always updates last_seen_at, even on an empty-events tick" is
    // exactly what this scenario is meant to cover.
    expect(device?.lastSeenAt).not.toBeNull();
    expect(device!.lastSeenAt!.getTime()).toBeGreaterThanOrEqual(before.getTime());
  });

  it('[11] rejects a request with a missing or invalid current_state', async () => {
    const res = await request(app)
      .post('/api/v1/events')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({ agent_status: 'running', current_state: 'sleeping', events: [] });

    expect(res.status).toBe(400);
    expect(res.body.details).toContain("current_state must be 'active' or 'idle'");
  });

  it('[12] persists current_state and state_duration_seconds on the device row from a heartbeat-only tick', async () => {
    const res = await request(app)
      .post('/api/v1/events')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({ agent_status: 'running', current_state: 'idle', state_duration_seconds: 42, events: [] });

    expect(res.status).toBe(202);

    const device = await prisma.device.findUnique({ where: { id: deviceId } });
    expect(device?.currentState).toBe('idle');
    expect(device?.stateDurationSeconds).toBe(42);
  });

  it('[13] rejects a request with a missing or invalid state_duration_seconds', async () => {
    const res = await request(app)
      .post('/api/v1/events')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({ agent_status: 'running', current_state: 'idle', state_duration_seconds: -1, events: [] });

    expect(res.status).toBe(400);
    expect(res.body.details).toContain('state_duration_seconds must be a non-negative integer');
  });
});
