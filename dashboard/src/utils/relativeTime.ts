// Hand-rolled rather than a dependency (date-fns, dayjs, …) — this is a
// small, well-understood formatting problem and the task calls for
// minimal dependencies to start.
const UNITS: Array<[label: string, seconds: number]> = [
  ['year', 31536000],
  ['month', 2592000],
  ['week', 604800],
  ['day', 86400],
  ['hour', 3600],
  ['minute', 60],
];

export function formatRelativeTime(isoString: string | null): string {
  if (!isoString) {
    return 'never';
  }

  const diffSeconds = Math.round((Date.now() - new Date(isoString).getTime()) / 1000);

  // Negative (clock skew, or "just now" landing a tick early) and
  // sub-10-second gaps both just read as "just now".
  if (diffSeconds < 10) {
    return 'just now';
  }

  for (const [label, secondsInUnit] of UNITS) {
    const value = Math.floor(diffSeconds / secondsInUnit);
    if (value >= 1) {
      return `${value} ${label}${value === 1 ? '' : 's'} ago`;
    }
  }

  return `${diffSeconds} seconds ago`;
}
