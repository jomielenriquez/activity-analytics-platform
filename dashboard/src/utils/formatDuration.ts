// Compact human duration ("45s", "12m", "3.5h") — used by the chart's
// tooltips/axis and the stats tiles/top-apps list. Hand-rolled for the
// same reason as relativeTime.ts: small, well-understood, not worth a
// dependency.
export function formatSeconds(totalSeconds: number): string {
  const seconds = Math.round(totalSeconds);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = minutes / 60;
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`;
}

// Precise "6m 40s"-style duration, used for the Devices table's
// active/idle state-duration display — unlike formatSeconds above (which
// rounds to a single unit for compact axis/tooltip labels), this keeps
// both minutes and seconds so "how long has this device been idle" reads
// as an exact elapsed time, not a rounded approximation.
export function formatDurationLong(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  const remainderSeconds = seconds % 60;

  if (minutes === 0) {
    return `${remainderSeconds}s`;
  }
  if (remainderSeconds === 0) {
    return `${minutes}m`;
  }
  return `${minutes}m ${remainderSeconds}s`;
}
