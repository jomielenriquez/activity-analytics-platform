import type { ActivityBucket, Bucket } from '../api';
import { formatSeconds } from '../utils/formatDuration';

// Hand-rolled SVG rather than a charting library (recharts, etc.) — the
// brief explicitly says "basic is enough" and offers this as one of two
// reasonable choices. This project has consistently avoided a dependency
// for problems tractable by hand (the agent's UUID generation, this
// dashboard's relative-time formatting); a two-series bucketed bar chart
// is more work than either of those, but the dataviz skill's mark specs
// (bar caps, stacking gaps, gridlines) give enough to build it correctly
// without needing a library's defaults. Bars, not a line: the backend
// never zero-fills missing buckets (DESIGN.md known limitation #8), and a
// line chart's connecting strokes would visually claim continuity across
// a gap that isn't there — a bar chart just omits the bar, which is
// honest. Simplified relative to the skill's full interaction spec, given
// the "basic" scope: native SVG <title> tooltips on hover/focus instead of
// a custom crosshair+tooltip layer; every value is still visible via the
// axis and the stat tiles/top-apps table elsewhere on the page.
const CHART_WIDTH = 800;
const CHART_HEIGHT = 220;
const MARGIN = { top: 12, right: 12, bottom: 28, left: 48 };
const MAX_BAR_THICKNESS = 24; // mark spec: bar/column caps at 24px, never fills its slot
const STACK_GAP = 2; // mark spec: 2px surface-color gap between touching segments
const CORNER_RADIUS = 4; // mark spec: 4px rounded data-end, square at the baseline

function niceMax(value: number): number {
  if (value <= 0) return 60;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

function formatBucketLabel(iso: string, bucket: Bucket): string {
  const date = new Date(iso);
  return bucket === 'hour'
    ? date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function shouldLabelIndex(index: number, total: number): boolean {
  const maxLabels = 8;
  const step = Math.max(1, Math.ceil(total / maxLabels));
  return index % step === 0 || index === total - 1;
}

// A rect path with only the top two corners rounded (data-end) and a
// square bottom (baseline) — plain SVG `rect rx` rounds all four corners,
// which isn't what the spec calls for on a bar touching the baseline.
function roundedTopRectPath(x: number, y: number, width: number, height: number, radius: number): string {
  const r = Math.min(radius, width / 2, Math.max(height, 0));
  if (height <= 0) return '';
  return `M ${x} ${y + height} L ${x} ${y + r} Q ${x} ${y} ${x + r} ${y} L ${x + width - r} ${y} Q ${x + width} ${y} ${x + width} ${y + r} L ${x + width} ${y + height} Z`;
}

export function ActivityChart({ buckets, bucketType }: { buckets: ActivityBucket[]; bucketType: Bucket }) {
  const plotWidth = CHART_WIDTH - MARGIN.left - MARGIN.right;
  const plotHeight = CHART_HEIGHT - MARGIN.top - MARGIN.bottom;
  const baseline = MARGIN.top + plotHeight;

  const maxTotal = Math.max(0, ...buckets.map((b) => b.active_seconds + b.idle_seconds));
  const yMax = niceMax(maxTotal);
  const yScale = (value: number) => (value / yMax) * plotHeight;

  const slotWidth = plotWidth / buckets.length;
  const barWidth = Math.min(MAX_BAR_THICKNESS, slotWidth - 4);

  return (
    <div>
      <div className="chart-legend">
        <span className="chart-legend-item">
          <span className="chart-legend-swatch chart-legend-swatch--active" /> Active
        </span>
        <span className="chart-legend-item">
          <span className="chart-legend-swatch chart-legend-swatch--idle" /> Idle
        </span>
      </div>

      <svg
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        className="activity-chart"
        role="img"
        aria-label="Active and idle time per bucket over time"
      >
        {[0, 0.25, 0.5, 0.75, 1].map((t) => {
          const y = MARGIN.top + plotHeight - t * plotHeight;
          return (
            <line
              key={t}
              x1={MARGIN.left}
              x2={CHART_WIDTH - MARGIN.right}
              y1={y}
              y2={y}
              className="chart-gridline"
            />
          );
        })}

        {[0, 0.5, 1].map((t) => {
          const y = MARGIN.top + plotHeight - t * plotHeight;
          return (
            <text key={t} x={MARGIN.left - 8} y={y} textAnchor="end" dominantBaseline="middle" className="chart-axis-label">
              {formatSeconds(t * yMax)}
            </text>
          );
        })}

        {buckets.map((bucket, index) => {
          const x = MARGIN.left + index * slotWidth + (slotWidth - barWidth) / 2;
          const activeHeight = yScale(bucket.active_seconds);
          const idleHeight = yScale(bucket.idle_seconds);
          const hasBoth = bucket.active_seconds > 0 && bucket.idle_seconds > 0;
          const gap = hasBoth ? STACK_GAP : 0;

          const activeY = baseline - activeHeight;
          const idleY = activeY - gap - idleHeight;
          const activeIsOutermost = bucket.idle_seconds === 0;

          const label = formatBucketLabel(bucket.bucket_start, bucketType);

          return (
            <g key={bucket.bucket_start}>
              {bucket.active_seconds > 0 &&
                (activeIsOutermost ? (
                  <path
                    d={roundedTopRectPath(x, activeY, barWidth, activeHeight, CORNER_RADIUS)}
                    className="chart-bar chart-bar--active"
                  >
                    <title>{`${label}: active ${formatSeconds(bucket.active_seconds)}`}</title>
                  </path>
                ) : (
                  <rect x={x} y={activeY} width={barWidth} height={activeHeight} className="chart-bar chart-bar--active">
                    <title>{`${label}: active ${formatSeconds(bucket.active_seconds)}`}</title>
                  </rect>
                ))}

              {bucket.idle_seconds > 0 && (
                <path
                  d={roundedTopRectPath(x, idleY, barWidth, idleHeight, CORNER_RADIUS)}
                  className="chart-bar chart-bar--idle"
                >
                  <title>{`${label}: idle ${formatSeconds(bucket.idle_seconds)}`}</title>
                </path>
              )}

              {shouldLabelIndex(index, buckets.length) && (
                <text x={x + barWidth / 2} y={CHART_HEIGHT - 8} textAnchor="middle" className="chart-axis-label">
                  {label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
