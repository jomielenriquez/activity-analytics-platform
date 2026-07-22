import { useState } from 'react';
import { getRecentActivity } from '../api';
import { errorMessage, useApiData } from '../hooks/useApiData';

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString();
}

// Manual refresh, not the Devices view's 15s poll — deliberately different
// from that view. Devices directly answers "who's online right now," where
// staleness actively matters; this is more of a historical feed, where a
// couple hundred rows silently re-sorting out from under someone mid-read
// is more disruptive than useful, and a small amount of staleness is fine.
// A button also means the request only fires when someone's actually
// looking at this view, not indefinitely every 15s in the background.
export function RecentActivityPage() {
  const [refreshKey, setRefreshKey] = useState(0);
  const { data: items, error, loading } = useApiData(() => getRecentActivity(), [refreshKey]);

  return (
    <div>
      <div className="page-toolbar">
        <button type="button" onClick={() => setRefreshKey((k) => k + 1)} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {loading && !items && <p className="state-message">Loading recent activity…</p>}

      {Boolean(error) && !items && (
        <p className="state-message state-message--error" role="alert">
          Failed to load recent activity: {errorMessage(error)}
        </p>
      )}

      {Boolean(error) && items && (
        <p className="state-message state-message--error" role="alert">
          Failed to refresh: {errorMessage(error)} (showing last known data)
        </p>
      )}

      {items && items.length === 0 && <p className="state-message">No activity recorded yet.</p>}

      {items && items.length > 0 && (
        <table className="device-table">
          <thead>
            <tr>
              <th>Device</th>
              <th>Type</th>
              <th>App</th>
              <th>Window title</th>
              <th>Started</th>
              <th>Duration</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => (
              // No stable id in this response shape — index is fine here
              // since this list is replaced wholesale on each fetch, never
              // reordered/patched in place.
              // eslint-disable-next-line react/no-array-index-key
              <tr key={index}>
                <td>{item.device_name}</td>
                <td>{item.type}</td>
                <td>{item.app_name ?? '—'}</td>
                <td>{item.window_title ?? '—'}</td>
                <td>{formatDateTime(item.started_at)}</td>
                <td>{item.duration_seconds}s</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
