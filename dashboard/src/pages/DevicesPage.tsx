import { Link } from 'react-router-dom';
import { getDevices } from '../api';
import { StatusBadge } from '../components/StatusBadge';
import { formatRelativeTime } from '../utils/relativeTime';
import { formatDurationLong } from '../utils/formatDuration';
import { errorMessage, useApiData } from '../hooks/useApiData';

const POLL_INTERVAL_MS = 15000;

export function DevicesPage() {
  const { data: devices, error, loading } = useApiData(getDevices, [], POLL_INTERVAL_MS);

  if (loading) {
    return <p className="state-message">Loading devices…</p>;
  }

  if (error && !devices) {
    return (
      <p className="state-message state-message--error" role="alert">
        Failed to load devices: {errorMessage(error)}
      </p>
    );
  }

  return (
    <div>
      {Boolean(error) && (
        <p className="state-message state-message--error" role="alert">
          Failed to refresh: {errorMessage(error)} (showing last known data)
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
                <td>
                  <Link to={`/devices/${device.id}/timeline`} className="row-link">
                    {device.device_name}
                  </Link>
                </td>
                <td>{device.os}</td>
                <td>{device.user_identifier}</td>
                <td>{formatRelativeTime(device.last_seen_at)}</td>
                <td>
                  <StatusBadge status={device.status} />
                  {device.status === 'idle' && device.state_duration_seconds !== null && (
                    <span className="status-duration">
                      {' '}
                      for {formatDurationLong(device.state_duration_seconds)}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
