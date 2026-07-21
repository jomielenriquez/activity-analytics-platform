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

export interface Device {
  id: string;
  device_name: string;
  os: string;
  user_identifier: string;
  last_seen_at: string | null;
  status: DeviceStatus;
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
    throw new Error(`${response.status} ${response.statusText}${body ? `: ${body}` : ''}`);
  }

  return response.json() as Promise<T>;
}

export function getDevices(): Promise<Device[]> {
  return apiFetch<Device[]>('/api/v1/devices');
}
