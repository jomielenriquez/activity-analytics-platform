import type { Prisma } from '@prisma/client';
import { isValidDateString } from '../validation';

export interface DateRangeResult {
  errors: string[];
  from?: Date;
  to?: Date;
}

// Shared by any endpoint accepting optional ?from&to ISO-timestamp filters
// (stats/summary, stats/top-apps): both are optional, but if present must
// parse as a valid date, else it's a 400, not a silently-ignored filter.
export function parseDateRangeQuery(query: Record<string, unknown>): DateRangeResult {
  const errors: string[] = [];
  let from: Date | undefined;
  let to: Date | undefined;

  if (query.from !== undefined) {
    if (!isValidDateString(query.from)) {
      errors.push('from must be a valid ISO timestamp');
    } else {
      from = new Date(query.from);
    }
  }

  if (query.to !== undefined) {
    if (!isValidDateString(query.to)) {
      errors.push('to must be a valid ISO timestamp');
    } else {
      to = new Date(query.to);
    }
  }

  return { errors, from, to };
}

// Shared by any endpoint filtering activity_segments.started_at by an
// already-parsed { from, to } (stats/summary, stats/top-apps,
// devices/:id/timeline).
export function buildStartedAtFilter(from?: Date, to?: Date): Prisma.DateTimeFilter | undefined {
  if (!from && !to) {
    return undefined;
  }
  return { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
}
