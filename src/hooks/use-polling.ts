"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface UsePollingResult<T> {
  /** Latest successfully-fetched value, or null until the first success. */
  data: T | null;
  /** Error from the most recent failed fetch, or null if the last fetch succeeded. */
  error: Error | null;
  /** True until the first fetch settles (success or failure). */
  loading: boolean;
  /** Imperatively trigger a fetch now (e.g. after a mutation). Never throws. */
  refresh: () => Promise<void>;
}

export interface UsePollingOptions {
  /** Poll interval in ms. <= 0 disables interval polling (fetch once on mount). */
  intervalMs?: number;
  /** When false, the hook does nothing (no fetch, no interval). Default true. */
  enabled?: boolean;
  /** Pause polling while the tab is hidden (document.hidden). Default true. */
  pauseWhenHidden?: boolean;
}

/**
 * Robust polling hook.
 *
 * - Calls `fetcher` on mount and then every `intervalMs`.
 * - Aborts the in-flight request on unmount via AbortController (the signal is
 *   passed to the fetcher so callers can wire it into `fetch`).
 * - Never calls setState after unmount.
 * - Pauses polling while `document.hidden` and refetches on becoming visible.
 * - Never throws: fetcher rejections are captured into `error`.
 *
 * No setState is called synchronously in an effect body — all state updates
 * happen inside async callbacks or event handlers — so this avoids the React
 * Compiler "Calling setState synchronously within an effect" lint rule.
 */
export function usePolling<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  options: UsePollingOptions = {},
): UsePollingResult<T> {
  const { intervalMs = 5000, enabled = true, pauseWhenHidden = true } = options;

  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);

  // Keep the latest fetcher in a ref so changing its identity each render does
  // not restart the polling effect. The ref is updated in an effect (never
  // during render) to satisfy the rules of hooks.
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  }, [fetcher]);

  const mountedRef = useRef(true);
  const inFlightRef = useRef<AbortController | null>(null);

  const runFetch = useCallback(async () => {
    // Abort any previous in-flight request before starting a new one.
    inFlightRef.current?.abort();
    const controller = new AbortController();
    inFlightRef.current = controller;

    try {
      const result = await fetcherRef.current(controller.signal);
      if (!mountedRef.current || controller.signal.aborted) return;
      setData(result);
      setError(null);
    } catch (err) {
      // Aborts are expected (unmount / superseded) — never surface them.
      if (controller.signal.aborted) return;
      if (err instanceof DOMException && err.name === "AbortError") return;
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      if (mountedRef.current && inFlightRef.current === controller) {
        setLoading(false);
      }
    }
  }, []);

  // Stable imperative refresh that callers can put in deps without churn.
  const refresh = useCallback(async () => {
    await runFetch();
  }, [runFetch]);

  useEffect(() => {
    mountedRef.current = true;
    if (!enabled) {
      // Nothing to poll; settle the loading state so consumers don't hang.
      // Deferred to a microtask so it is not a synchronous setState in the effect.
      void Promise.resolve().then(() => {
        if (mountedRef.current) setLoading(false);
      });
      return () => {
        mountedRef.current = false;
      };
    }

    let timer: ReturnType<typeof setInterval> | null = null;

    const tick = () => {
      if (pauseWhenHidden && typeof document !== "undefined" && document.hidden) {
        return;
      }
      void runFetch();
    };

    // Initial fetch (deferred to a microtask so it is not a synchronous setState
    // inside the effect body). NOTE: this calls runFetch() directly rather than tick(),
    // so the FIRST load always happens even when the tab is hidden. Routing it through
    // tick() would skip it under pauseWhenHidden, leaving `loading` stuck true (a perpetual
    // skeleton) until the tab gains focus — e.g. when the app is opened in a background tab.
    // Only the recurring interval below respects pauseWhenHidden.
    void Promise.resolve().then(() => {
      if (mountedRef.current) void runFetch();
    });

    if (intervalMs > 0) {
      timer = setInterval(tick, intervalMs);
    }

    const onVisibility = () => {
      if (!pauseWhenHidden) return;
      if (typeof document !== "undefined" && !document.hidden) {
        void runFetch();
      }
    };
    if (pauseWhenHidden && typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibility);
    }

    return () => {
      mountedRef.current = false;
      if (timer) clearInterval(timer);
      inFlightRef.current?.abort();
      if (pauseWhenHidden && typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibility);
      }
    };
  }, [enabled, intervalMs, pauseWhenHidden, runFetch]);

  return { data, error, loading, refresh };
}
