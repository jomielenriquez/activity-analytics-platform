import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, getDeviceTimeline } from '../api';
import { errorMessage, useApiData } from '../hooks/useApiData';

const TITLE_TRUNCATE_LENGTH = 80;

function truncate(text: string | null, length: number): string {
  if (!text) return '—';
  return text.length > length ? `${text.slice(0, length)}…` : text;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString();
}

export function TimelinePage() {
  const { id } = useParams<{ id: string }>();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const { data: segments, error, loading } = useApiData(
    () => getDeviceTimeline(id!, from || undefined, to || undefined),
    [id, from, to],
  );

  const notFound = error instanceof ApiError && error.status === 404;

  return (
    <div>
      <p className="page-breadcrumb">
        <Link to="/">Devices</Link> / Timeline
      </p>

      <div className="filter-row">
        <label>
          From{' '}
          <input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          To <input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>

      {loading && <p className="state-message">Loading timeline…</p>}

      {!loading && Boolean(error) && (
        <p className="state-message state-message--error" role="alert">
          {notFound
            ? 'Device not found — check the URL, this device id may not exist.'
            : `Failed to load timeline: ${errorMessage(error)}`}
        </p>
      )}

      {!loading && !error && segments && segments.length === 0 && (
        <p className="state-message">No activity recorded for this device yet.</p>
      )}

      {!loading && !error && segments && segments.length > 0 && (
        <ul className="timeline-list">
          {segments.map((segment) => (
            <li key={segment.client_segment_id} className={`timeline-item timeline-item--${segment.type}`}>
              <span className="timeline-item-type">{segment.type}</span>
              <span className="timeline-item-app">{segment.app_name ?? '—'}</span>
              <span className="timeline-item-title">
                {truncate(segment.window_title, TITLE_TRUNCATE_LENGTH)}
              </span>
              <span className="timeline-item-time">{formatDateTime(segment.started_at)}</span>
              <span className="timeline-item-duration">{segment.duration_seconds}s</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
