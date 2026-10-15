import { useCallback, useEffect, useRef, useState } from "react";
import { getFeedStatus, onRefTime, refNow, type FeedStatus } from "../lib/clock";

export interface PollState<T> {
  data: T | null;
  error: Error | null;
  /** True only while the very first request (or the first after a deps change) is in flight. */
  loading: boolean;
  lastUpdated: number | null;
  refresh: () => void;
}

/**
 * Calls `fetcher` now and then every `intervalMs` (null = only once).
 * Pauses while the tab is hidden and refreshes as soon as it becomes visible again.
 * Keeps the previous data while refreshing; resets when `deps` change.
 */
export function usePolling<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  intervalMs: number | null,
  deps: unknown[] = [],
): PollState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const runRef = useRef<() => void>(() => {});

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    let ctrl: AbortController | null = null;
    setData(null);
    setError(null);
    setLoading(true);

    const schedule = () => {
      if (cancelled || intervalMs === null) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(run, intervalMs);
    };

    async function run() {
      if (cancelled) return;
      if (document.hidden && intervalMs !== null) return; // resumed by visibilitychange
      ctrl?.abort();
      ctrl = new AbortController();
      try {
        const result = await fetcherRef.current(ctrl.signal);
        if (cancelled) return;
        setData(result);
        setError(null);
        setLastUpdated(Date.now());
      } catch (e) {
        if (cancelled || (e as Error).name === "AbortError") return;
        setError(e as Error);
      } finally {
        if (!cancelled) setLoading(false);
      }
      schedule();
    }
    runRef.current = () => {
      window.clearTimeout(timer);
      run();
    };

    const onVisibility = () => {
      if (!document.hidden) {
        window.clearTimeout(timer);
        run();
      } else {
        window.clearTimeout(timer);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    run();
    return () => {
      cancelled = true;
      ctrl?.abort();
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs, ...deps]);

  const refresh = useCallback(() => runRef.current(), []);
  return { data, error, loading, lastUpdated, refresh };
}

/**
 * Current time on the reference clock (latest API event time + elapsed), re-rendered every
 * `intervalMs` and whenever a new ref_time arrives. Use it for "il y a 2 min" labels.
 */
export function useNow(intervalMs = 5000): number {
  const [now, setNow] = useState(() => refNow());
  useEffect(() => {
    const tick = () => setNow(refNow());
    const id = window.setInterval(tick, intervalMs);
    const off = onRefTime(tick);
    return () => {
      window.clearInterval(id);
      off();
    };
  }, [intervalMs]);
  return now;
}

/** Returns `value` after it stopped changing for `delayMs`. */
export function useDebounced<T>(value: T, delayMs: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setV(value), delayMs);
    return () => window.clearTimeout(id);
  }, [value, delayMs]);
  return v;
}

/** True when the user asked the OS to reduce motion. */
export function useReducedMotion(): boolean {
  const query = "(prefers-reduced-motion: reduce)";
  const [reduced, setReduced] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

/** Latest feed status (reference time + ingestion rate), updated whenever /api/stats answers. */
export function useFeedStatus(): FeedStatus {
  const [f, setF] = useState<FeedStatus>(() => getFeedStatus());
  useEffect(() => onRefTime(() => setF(getFeedStatus())), []);
  return f;
}
