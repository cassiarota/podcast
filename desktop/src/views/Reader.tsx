import { useEffect, useRef, useState } from "react";
import { useReaderStore } from "../state/reader";
import { useSettingsStore } from "../state/settings";
import { useT } from "../lib/i18n";
import { TOC } from "./TOC";

const AUTO_HIDE_MS = 2200;
const SWIPE_THRESHOLD_PX = 50;
const SWIPE_MAX_DURATION_MS = 600;

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
  // - When the controls are visible: any tap on the main area hides them.
  //   We deliberately do NOT advance the page in that case — matching the
  //   "tap outside menu to hide" mental model.
  // - When hidden:
  //   - In "tap" mode: left/right thirds turn pages; center reveals controls.
  //   - In "swipe" mode: a horizontal drag turns pages; a stationary tap
  //     toggles controls.
  const pointerStartRef = useRef<{ x: number; y: number; t: number } | null>(null);

  const handleMainPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    pointerStartRef.current = { x: e.clientX, y: e.clientY, t: e.timeStamp };
  };

  const handleMainPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const start = pointerStartRef.current;
    pointerStartRef.current = null;
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    const dt = e.timeStamp - start.t;
    const target = e.currentTarget;
    const width = target.clientWidth;

    // 1. If menu visible → any pointer up hides it. Don't turn page.
    if (controlsVisible) {
      hideControls();
      return;
    }

    // 2. Recognize swipe (large horizontal delta, small vertical, quick).
    const isSwipe =
      settings.pageTurnMode === "swipe" &&
      Math.abs(dx) >= SWIPE_THRESHOLD_PX &&
      Math.abs(dx) > Math.abs(dy) * 1.5 &&
      dt < SWIPE_MAX_DURATION_MS;
    if (isSwipe) {
      if (dx < 0) next();
      else prev();
      return;
    }

    // 3. Treat the rest as a stationary tap.
    if (settings.pageTurnMode === "tap") {
      // Tap regions: left third = prev, right third = next, center = menu.
      const x = e.clientX;
      if (x < width / 3) prev();
      else if (x > (2 * width) / 3) next();
      else showControls();
    } else {
      // In swipe mode, a single tap toggles the menu (it's the only way to
      // reach it).
      toggleControls();
    }
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
  const [busy, setBusy] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  if (!page) return null;
  return (
    <button
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const { api } = await import("../lib/api");
          const chunk = await api.playCachedOrGenerate(
            page.book_id,
            page.id,
            "" // empty → backend reads saved TtsSettings.voice
          );
          const { convertFileSrc } = await import("@tauri-apps/api/core");
          const url = convertFileSrc(chunk.path);
          if (!audioRef.current) audioRef.current = new Audio();
          audioRef.current.src = url;
          await audioRef.current.play();
        } catch (e) {
          console.error("playback failed", e);
          alert(`${t("reader.ttsErrorTitle")}: ${e}`);
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? t("reader.busy") : t("reader.play")}
    </button>
  );
}
