import { useEffect, useRef, useState } from "react";
import { useReaderStore } from "../state/reader";
import { useSettingsStore } from "../state/settings";
import { usePlayerStore } from "../state/player";
import { useT } from "../lib/i18n";
import { TOC } from "./TOC";

const AUTO_HIDE_MS = 2200;
const SWIPE_THRESHOLD_PX = 40;

interface ReaderProps {
  bookId: string;
  onOpenSettings: () => void;
}

export function Reader({ bookId, onOpenSettings }: ReaderProps) {
  const t = useT();
  const open = useReaderStore((s) => s.open);
  const close = useReaderStore((s) => s.close);
  const next = useReaderStore((s) => s.next);
  const prev = useReaderStore((s) => s.prev);
  const page = useReaderStore((s) => s.currentPage);
  const pageIndex = useReaderStore((s) => s.pageIndex);
  const pageCount = useReaderStore((s) => s.pageCount);
  const controlsVisible = useReaderStore((s) => s.controlsVisible);
  const toggleControls = useReaderStore((s) => s.toggleControls);
  const hideControls = useReaderStore((s) => s.hideControls);
  const showControls = useReaderStore((s) => s.showControls);
  const tocOpen = useReaderStore((s) => s.tocOpen);
  const setTocOpen = useReaderStore((s) => s.setTocOpen);
  const settings = useSettingsStore((s) => s.settings);
  const updateSettings = useSettingsStore((s) => s.update);

  const hideTimerRef = useRef<number | null>(null);

  useEffect(() => {
    open(bookId);
  }, [bookId, open]);

  // Auto-hide is now opt-in via settings.menuAutoHide. Default: stays visible
  // until the user taps the main content area (not the menu) — that hide
  // happens in handleMainPointerUp below.
  useEffect(() => {
    if (!controlsVisible || !settings.menuAutoHide) return;
    if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = window.setTimeout(hideControls, AUTO_HIDE_MS);
    return () => {
      if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    };
  }, [controlsVisible, hideControls, pageIndex, settings.menuAutoHide]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") prev();
      else if (e.key === "ArrowRight") next();
      else if (e.key === "Escape") {
        if (controlsVisible) hideControls();
        else close();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, prev, close, controlsVisible, hideControls]);

  // Pointer-based gesture handling for the main content area.
  // - When the controls are visible: any pointer up hides them. No page turn.
  // - When hidden:
  //   - "tap" mode: left/right thirds turn pages; center reveals controls.
  //   - "swipe" mode: any drag whose dominant axis exceeds the threshold
  //     turns a page (left/up = next, right/down = prev). Stationary tap
  //     toggles controls.
  const pointerStartRef = useRef<{ x: number; y: number; t: number } | null>(null);

  const handleMainPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    pointerStartRef.current = { x: e.clientX, y: e.clientY, t: e.timeStamp };
    // Capture the pointer so we get the matching pointerup even if the
    // pointer leaves the overlay area mid-drag (the common case for a
    // mouse drag that drifts upward into the menu region).
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* old browsers — ignore */
    }
  };

  const handleMainPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const start = pointerStartRef.current;
    pointerStartRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    const target = e.currentTarget;
    const width = target.clientWidth;

    // 1. If TOC is open, any pointer up on the main area closes it.
    //    Don't turn page in that case.
    if (tocOpen) {
      setTocOpen(false);
      return;
    }
    // 2. If menu visible → any pointer up hides it. Don't turn page.
    if (controlsVisible) {
      hideControls();
      return;
    }

    // 2. Recognize swipe — accept either horizontal OR vertical drag whose
    //    magnitude clears the threshold. Whichever axis is larger wins.
    if (settings.pageTurnMode === "swipe") {
      const absX = Math.abs(dx);
      const absY = Math.abs(dy);
      const dominant = absX >= absY ? "x" : "y";
      const magnitude = Math.max(absX, absY);
      if (magnitude >= SWIPE_THRESHOLD_PX) {
        // For both axes: forward (left or up) = next, back (right or down) = prev.
        const forward = dominant === "x" ? dx < 0 : dy < 0;
        if (forward) next();
        else prev();
        return;
      }
      // Stationary tap → toggle menu (the only way to open it in swipe mode).
      toggleControls();
      return;
    }

    // 3. Tap mode: left third = prev, right third = next, center = menu.
    const x = e.clientX;
    if (x < width / 3) prev();
    else if (x > (2 * width) / 3) next();
    else showControls();
  };

  const percent = pageCount > 0 ? Math.round(((pageIndex + 1) / pageCount) * 100) : 0;

  return (
    <div className="reader">
      <div className="reader-content" aria-label={page?.section_id || ""}>
        {page?.content ?? ""}
      </div>

      <div
        className="tap-overlay"
        onPointerDown={handleMainPointerDown}
        onPointerUp={handleMainPointerUp}
        aria-label={t("reader.toggleControls")}
      />

      <TOC open={tocOpen} onClose={() => setTocOpen(false)} />

      <div
        className={`controls ${controlsVisible ? "" : "hidden"}`}
        onPointerDown={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
      >
        <button onClick={close}>{t("reader.back")}</button>
        <button onClick={() => setTocOpen(true)}>{t("reader.contents")}</button>
        <button onClick={onOpenSettings}>{t("reader.settings")}</button>
        <label>
          {t("settings.reading.fontSize")}
          <select
            value={settings.fontSize}
            onChange={(e) =>
              updateSettings({ fontSize: e.target.value as "small" | "medium" | "large" })
            }
            style={{ marginLeft: 6 }}
          >
            <option value="small">{t("settings.reading.fontSize.small")}</option>
            <option value="medium">{t("settings.reading.fontSize.medium")}</option>
            <option value="large">{t("settings.reading.fontSize.large")}</option>
          </select>
        </label>
        <label>
          {t("settings.reading.brightness")}
          <input
            type="range"
            min="0.3"
            max="1"
            step="0.05"
            value={settings.brightness}
            onChange={(e) =>
              updateSettings({ brightness: parseFloat(e.target.value) })
            }
            style={{ marginLeft: 6 }}
          />
        </label>
        <div className="spacer" />
        <PlayButton />
        <div className="progress">{percent}%</div>
      </div>

      {/* Always-visible progress badge (works even when controls hidden) */}
      <div className={`progress-badge ${controlsVisible ? "with-controls" : ""}`}>
        {percent}%
      </div>
    </div>
  );
}

function PlayButton() {
  const t = useT();
  const page = useReaderStore((s) => s.currentPage);
  const status = usePlayerStore((s) => s.status);
  const playerPageId = usePlayerStore((s) => s.pageId);
  const error = usePlayerStore((s) => s.error);
  const positionMs = usePlayerStore((s) => s.positionMs);
  const durationMs = usePlayerStore((s) => s.durationMs);
  const play = usePlayerStore((s) => s.play);
  const pause = usePlayerStore((s) => s.pause);
  const resume = usePlayerStore((s) => s.resume);
  const stop = usePlayerStore((s) => s.stop);
  const clearError = usePlayerStore((s) => s.clearError);

  if (!page) return null;
  const isThisPage = playerPageId === page.id;
  const showLoading = status === "loading" && isThisPage;
  const showPlayingControls = (status === "playing" || status === "paused") && isThisPage;

  return (
    <>
      {error && (
        <div className="play-error" onClick={clearError} title={error}>
          ⚠ {error.length > 60 ? error.slice(0, 60) + "…" : error}
        </div>
      )}
      {showPlayingControls ? (
        <div className="play-controls">
          {status === "playing" ? (
            <button onClick={pause}>⏸ {t("reader.pause")}</button>
          ) : (
            <button onClick={resume}>▶ {t("reader.resume")}</button>
          )}
          <button onClick={stop}>⏹ {t("reader.stop")}</button>
          <span className="play-time">
            {fmtTime(positionMs)} / {fmtTime(durationMs)}
          </span>
        </div>
      ) : (
        <button
          disabled={showLoading}
          onClick={() => play(page.book_id, page.id)}
        >
          {showLoading ? t("reader.busy") : t("reader.play")}
        </button>
      )}
    </>
  );
}

function fmtTime(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
