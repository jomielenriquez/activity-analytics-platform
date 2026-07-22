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
