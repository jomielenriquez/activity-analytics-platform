// Typed client for the backend's admin-facing API. All requests carry the
// admin API key — every endpoint this dashboard calls requires it.

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL;
const ADMIN_API_KEY = import.meta.env.VITE_ADMIN_API_KEY;

if (!BACKEND_URL || !ADMIN_API_KEY) {
  // Fails loudly at module load rather than surfacing as a mysterious
  // failed fetch later — mirrors the backend's own fail-fast env
  // validation in index.ts.
  throw new Error(
    'Missing VITE_BACKEND_URL or VITE_ADMIN_API_KEY. Copy .env.example to .env and fill in both.',
  );
}

export type DeviceStatus = 'active' | 'idle' | 'paused' | 'offline';
export type SegmentType = 'active' | 'idle';
export type Bucket = 'hour' | 'day';

export interface Device {
  id: string;
  device_name: string;
  os: string;
  user_identifier: string;
  last_seen_at: string | null;
  status: DeviceStatus;
  state_duration_seconds: number | null;
}

export interface TimelineSegment {
  client_segment_id: string;
  type: SegmentType;
  app_name: string | null;
  window_title: string | null;
  started_at: string;
  ended_at: string;
  duration_seconds: number;
}

export interface StatsSummary {
  active_device_count: number;
  total_active_seconds: number;
  total_idle_seconds: number;
}

export interface TopApp {
  app_name: string;
  total_seconds: number;
}

export interface ActivityBucket {
  bucket_start: string;
  active_seconds: number;
  idle_seconds: number;
}

export interface RecentActivityItem {
  device_name: string;
  type: SegmentType;
  app_name: string | null;
  window_title: string | null;
  started_at: string;
  ended_at: string;
  duration_seconds: number;
}

// Carries the HTTP status so callers can branch on specific codes (e.g.
// the Timeline view treating 404 as "bad device id" rather than a generic
// failure) instead of parsing the message string.
export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

function buildQuery(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') {
      search.set(key, String(value));
    }
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

async function apiFetch<T>(path: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BACKEND_URL}${path}`, {
      headers: { Authorization: `Bearer ${ADMIN_API_KEY}` },
    });
  } catch {
    throw new Error(`Could not reach the backend at ${BACKEND_URL} — is it running?`);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new ApiError(
      response.status,
      `${response.status} ${response.statusText}${body ? `: ${body}` : ''}`,
    );
  }

  return response.json() as Promise<T>;
}

export function getDevices(): Promise<Device[]> {
  return apiFetch<Device[]>('/api/v1/devices');
}

export function getDeviceTimeline(deviceId: string, from?: string, to?: string): Promise<TimelineSegment[]> {
  return apiFetch<TimelineSegment[]>(`/api/v1/devices/${deviceId}/timeline${buildQuery({ from, to })}`);
}

export function getStatsSummary(from?: string, to?: string): Promise<StatsSummary> {
  return apiFetch<StatsSummary>(`/api/v1/stats/summary${buildQuery({ from, to })}`);
}

export function getTopApps(from?: string, to?: string, deviceId?: string): Promise<TopApp[]> {
  return apiFetch<TopApp[]>(`/api/v1/stats/top-apps${buildQuery({ from, to, device_id: deviceId })}`);
}

export function getActivityOverTime(
  bucket: Bucket,
  from?: string,
  to?: string,
  deviceId?: string,
): Promise<ActivityBucket[]> {
  return apiFetch<ActivityBucket[]>(
    `/api/v1/stats/activity-over-time${buildQuery({ bucket, from, to, device_id: deviceId })}`,
  );
}

export function getRecentActivity(limit?: number): Promise<RecentActivityItem[]> {
  return apiFetch<RecentActivityItem[]>(`/api/v1/activity/recent${buildQuery({ limit })}`);
}
