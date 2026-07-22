import { useEffect, useRef, useState } from 'react';

interface UseApiDataResult<T> {
  data: T | null;
  error: unknown;
  loading: boolean;
}

// Shared loading/error/(optional poll) pattern, used by every view in this
// dashboard: an initial fetch shows a loading state; a failure with no
// prior data is a hard error (nothing to show); a *later* failure — a
// poll tick, or a refetch triggered by `deps` changing — keeps whatever
// data is already on screen and surfaces a soft "failed to refresh" error
// instead of blanking the view. `deps` changing resets to the loading
// state (a real new query, e.g. a date-range filter changed); a poll tick
// firing does not (a silent background refresh).
//
// `error` is kept as the raw thrown value (not pre-formatted to a string)
// specifically so callers can branch on its type — e.g. the Timeline view
// checking `error instanceof ApiError && error.status === 404` — instead
// of parsing a message string.
export function useApiData<T>(
  fetcher: () => Promise<T>,
  deps: React.DependencyList,
  pollMs?: number,
): UseApiDataResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);

  // Always call the latest fetcher (it closes over current filter state)
  // without making it a dependency itself — only `deps` should decide
  // when to re-fetch.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  // deps is caller-supplied (this is a generic hook, not a specific
  // component), so oxlint can't statically verify it — that's expected
  // here, not a missing dependency.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    async function load() {
      try {
        const result = await fetcherRef.current();
        if (cancelled) return;
        setData(result);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();

    let interval: ReturnType<typeof setInterval> | undefined;
    if (pollMs) {
      interval = setInterval(load, pollMs);
    }

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
    // deps is this generic hook's caller-supplied dependency list, not a
    // literal array — expected here, not a mistake.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, error, loading };
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Failed to load';
}
