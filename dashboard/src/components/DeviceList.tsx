import { useEffect, useState } from 'react';
import { getDevices, type Device } from '../api';
import { StatusBadge } from './StatusBadge';
import { formatRelativeTime } from '../utils/relativeTime';

const POLL_INTERVAL_MS = 15000;

export function DeviceList() {
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const data = await getDevices();
        if (cancelled) return;
        setDevices(data);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        // Keep whatever devices are already on screen — a transient poll
        // failure shouldn't blank out data the user was already looking
        // at, but the failure must still be clearly visible.
        setError(err instanceof Error ? err.message : 'Failed to load devices');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    const interval = setInterval(load, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (loading) {
    return <p className="state-message">Loading devices…</p>;
  }

  if (error && !devices) {
    // Never successfully loaded anything — a hard failure, not a
    // stale-but-visible one.
    return (
      <p className="state-message state-message--error" role="alert">
        Failed to load devices: {error}
      </p>
    );
  }

  return (
    <div>
      {error && (
        <p className="state-message state-message--error" role="alert">
          Failed to refresh: {error} (showing last known data)
        </p>
      )}

      {devices && devices.length === 0 ? (
        <p className="state-message">No devices registered yet.</p>
      ) : (
        <table className="device-table">
          <thead>
            <tr>
              <th>Device name</th>
              <th>OS</th>
              <th>User</th>
              <th>Last seen</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {devices!.map((device) => (
              <tr key={device.id}>
                <td>{device.device_name}</td>
                <td>{device.os}</td>
                <td>{device.user_identifier}</td>
                <td>{formatRelativeTime(device.last_seen_at)}</td>
                <td>
                  <StatusBadge status={device.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
