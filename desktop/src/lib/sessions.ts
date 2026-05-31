import { useEffect, useRef } from "react";
import { api } from "../lib/api";

/**
 * Track an "app" session for the lifetime of the component.
 * Mount once at the root; the session id lives in a ref so React strict
 * mode double-mount doesn't double-count.
 *
 * The session is ended on page unload AND on best-effort browser visibility
 * change (window hidden for > 60 s ends the session, foreground restarts).
 */
export function useAppUsageSession() {
  const sessionIdRef = useRef<string | null>(null);
  const hiddenAtRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const id = await api.startSession("app");
        if (cancelled) {
          api.endSession(id).catch(() => {});
          return;
        }
        sessionIdRef.current = id;
      } catch (e) {
        console.error("[stats] startSession app failed", e);
      }
    })();

    const flush = () => {
      const id = sessionIdRef.current;
      if (id) {
        sessionIdRef.current = null;
        api.endSession(id).catch(() => {});
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAtRef.current = Date.now();
        // Don't end immediately — short blurs are normal. After 60 s of
        // hidden we end the session.
        const since = hiddenAtRef.current;
        setTimeout(() => {
          if (
            document.visibilityState === "hidden" &&
            hiddenAtRef.current === since
          ) {
            flush();
          }
        }, 60_000);
      } else {
        hiddenAtRef.current = null;
        if (!sessionIdRef.current) {
          api.startSession("app").then(
            (id) => {
              sessionIdRef.current = id;
            },
            () => {}
          );
        }
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("beforeunload", flush);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("beforeunload", flush);
      flush();
    };
  }, []);
}

/**
 * Track a "reading" session for the lifetime of the component (a book is
 * open in the Reader). Ends as soon as the user navigates away. Pass the
 * bookId so sessions are per-book.
 */
export function useReadingSession(bookId: string | null | undefined) {
  const sessionIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!bookId) return;
    let cancelled = false;
    (async () => {
      try {
        const id = await api.startSession("reading", bookId);
        if (cancelled) {
          api.endSession(id).catch(() => {});
          return;
        }
        sessionIdRef.current = id;
      } catch (e) {
        console.error("[stats] startSession reading failed", e);
      }
    })();
    return () => {
      cancelled = true;
      const id = sessionIdRef.current;
      sessionIdRef.current = null;
      if (id) api.endSession(id).catch(() => {});
    };
  }, [bookId]);
}
