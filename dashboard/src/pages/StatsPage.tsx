import { useState } from 'react';
import { getActivityOverTime, getStatsSummary, getTopApps, type Bucket } from '../api';
import { errorMessage, useApiData } from '../hooks/useApiData';
import { formatSeconds } from '../utils/formatDuration';
import { ActivityChart } from '../components/ActivityChart';

export function StatsPage() {
  const [bucket, setBucket] = useState<Bucket>('hour');

  const { data: summary, error: summaryError, loading: summaryLoading } = useApiData(getStatsSummary, []);
  const { data: topApps, error: topAppsError, loading: topAppsLoading } = useApiData(() => getTopApps(), []);
  const {
    data: buckets,
    error: bucketsError,
    loading: bucketsLoading,
  } = useApiData(() => getActivityOverTime(bucket), [bucket]);

  return (
    <div className="stats-page">
      <section>
        {summaryLoading && <p className="state-message">Loading summary…</p>}
        {Boolean(summaryError) && !summary && (
          <p className="state-message state-message--error" role="alert">
            Failed to load summary: {errorMessage(summaryError)}
          </p>
        )}
        {summary && (
          <div className="stat-tiles">
            <div className="stat-tile">
              <span className="stat-tile-label">Active devices</span>
              <span className="stat-tile-value">{summary.active_device_count}</span>
            </div>
            <div className="stat-tile">
              <span className="stat-tile-label">Total active time</span>
              <span className="stat-tile-value">{formatSeconds(summary.total_active_seconds)}</span>
            </div>
            <div className="stat-tile">
              <span className="stat-tile-label">Total idle time</span>
              <span className="stat-tile-value">{formatSeconds(summary.total_idle_seconds)}</span>
            </div>
          </div>
        )}
      </section>

      <section>
        <div className="section-header">
          <h2>Activity over time</h2>
          <div className="bucket-toggle">
            <button
              type="button"
              className={bucket === 'hour' ? 'toggle-btn toggle-btn--active' : 'toggle-btn'}
              onClick={() => setBucket('hour')}
            >
              Hour
            </button>
            <button
              type="button"
              className={bucket === 'day' ? 'toggle-btn toggle-btn--active' : 'toggle-btn'}
              onClick={() => setBucket('day')}
            >
              Day
            </button>
          </div>
        </div>

        {bucketsLoading && <p className="state-message">Loading chart…</p>}
        {Boolean(bucketsError) && !buckets && (
          <p className="state-message state-message--error" role="alert">
            Failed to load activity over time: {errorMessage(bucketsError)}
          </p>
        )}
        {/* Buckets with no segments are never zero-filled by the backend
            (DESIGN.md known limitation #8) — an empty array here just means
            no activity in range at all, handled explicitly rather than
            rendering a chart with nothing in it. */}
        {buckets && buckets.length === 0 && (
          <p className="state-message">No activity recorded in this range yet.</p>
        )}
        {buckets && buckets.length > 0 && <ActivityChart buckets={buckets} bucketType={bucket} />}
      </section>

      <section>
        <h2>Top apps</h2>
        {topAppsLoading && <p className="state-message">Loading top apps…</p>}
        {Boolean(topAppsError) && !topApps && (
          <p className="state-message state-message--error" role="alert">
            Failed to load top apps: {errorMessage(topAppsError)}
          </p>
        )}
        {topApps && topApps.length === 0 && <p className="state-message">No app activity recorded yet.</p>}
        {topApps && topApps.length > 0 && (
          <table className="device-table">
            <thead>
              <tr>
                <th>App</th>
                <th>Total time</th>
              </tr>
            </thead>
            <tbody>
              {topApps.map((app) => (
                <tr key={app.app_name}>
                  <td>{app.app_name}</td>
                  <td>{formatSeconds(app.total_seconds)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
