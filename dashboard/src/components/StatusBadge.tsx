import type { DeviceStatus } from '../api';

// active/idle/offline are genuine severity states, mapped onto the
// reserved status ladder (good/warning/critical). "paused" is a
// deliberate, user-initiated state, not a problem — it doesn't belong on
// that ladder, so it gets a neutral/muted indicator instead of being
// force-fit into "serious".
const STATUS_META: Record<DeviceStatus, { label: string; className: string }> = {
  active: { label: 'Active', className: 'status-dot--good' },
  idle: { label: 'Idle', className: 'status-dot--warning' },
  paused: { label: 'Paused', className: 'status-dot--neutral' },
  offline: { label: 'Offline', className: 'status-dot--critical' },
};

export function StatusBadge({ status }: { status: DeviceStatus }) {
  const meta = STATUS_META[status];

  return (
    <span className="status-badge">
      {/* Color lives on the dot, not the text — status color never carries
          meaning alone; the label always reads correctly on its own. */}
      <span className={`status-dot ${meta.className}`} aria-hidden="true" />
      {meta.label}
    </span>
  );
}
