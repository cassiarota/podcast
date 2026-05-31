import { useEffect, useMemo, useRef, useState } from "react";
import { useReaderStore } from "../state/reader";
import { useSettingsStore } from "../state/settings";
import { usePlayerStore } from "../state/player";
import { useT } from "../lib/i18n";
import { useReadingSession } from "../lib/sessions";
import { splitSentences } from "../lib/sentences";
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

  // Stats: tracks how long this book has been open in the reader.
  useReadingSession(bookId);

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
      <SentenceContent />

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

/**
 * Renders the page text broken into sentence spans. The currently-playing
 * sentence is highlighted; clicking a sentence opens a small floating
 * menu with ▶ Play-from-here / 📝 Save-as-note.
 */
function SentenceContent() {
  const page = useReaderStore((s) => s.currentPage);
  const playerSentences = usePlayerStore((s) => s.sentences);
  const currentIdx = usePlayerStore((s) => s.currentSentence);
  const playerPageId = usePlayerStore((s) => s.pageId);
  const playPage = usePlayerStore((s) => s.playPage);
  const stop = usePlayerStore((s) => s.stop);
  const [menu, setMenu] = useState<{ idx: number; x: number; y: number } | null>(null);

  // Compute the on-screen sentence list ONCE per page. We fall back to the
  // player's sentence cache when it's playing this page (which carries the
  // exact same split logic), otherwise re-split client-side.
  const sentences = useMemo(() => {
    if (!page) return [] as string[];
    if (
      playerPageId === page.id &&
      playerSentences.length > 0 &&
      playerSentences.every((s) => s.text)
    ) {
      return playerSentences.map((s) => s.text);
    }
    // Lazy import to avoid pulling sentences.ts at module top.
    return splitSentences(page.content);
  }, [page, playerSentences, playerPageId]);

  if (!page) return <div className="reader-content" />;

  const isThisPagePlaying = playerPageId === page.id && playerSentences.length > 0;

  return (
    <>
      <div className="reader-content" aria-label={page.section_id || ""}>
        {sentences.length === 0 ? (
          page.content
        ) : (
          sentences.map((s: string, i: number) => {
            const active = isThisPagePlaying && i === currentIdx;
            const loading = isThisPagePlaying && playerSentences[i]?.loading;
            return (
              <span
                key={i}
                className={`sentence ${active ? "sentence-active" : ""} ${loading ? "sentence-loading" : ""}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setMenu({ idx: i, x: e.clientX, y: e.clientY });
                }}
              >
                {s}
                {/* Preserve readable spacing between sentences. */}
                {" "}
              </span>
            );
          })
        )}
      </div>

      {menu && page && (
        <SentenceMenu
          x={menu.x}
          y={menu.y}
          sentenceText={sentences[menu.idx]}
          onPlay={async () => {
            const bid = page.book_id;
            const pid = page.id;
            setMenu(null);
            // Stop existing playback, then start from this sentence.
            stop();
            await playPage(bid, pid, page.content, menu.idx);
          }}
          onNote={async () => {
            try {
              await (await import("../lib/api")).api.addNote(
                page.book_id,
                page.id,
                menu.idx,
                sentences[menu.idx],
              );
              setMenu(null);
            } catch (e) {
              alert(`保存笔记失败: ${e}`);
            }
          }}
          onClose={() => setMenu(null)}
        />
      )}
    </>
  );
}

interface SentenceMenuProps {
  x: number;
  y: number;
  sentenceText: string;
  onPlay: () => void;
  onNote: () => void;
  onClose: () => void;
}

function SentenceMenu({ x, y, onPlay, onNote, onClose }: SentenceMenuProps) {
  useEffect(() => {
    const close = () => onClose();
    const id = window.setTimeout(() => {
      window.addEventListener("pointerdown", close, { once: true });
    }, 100);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener("pointerdown", close);
    };
  }, [onClose]);
  return (
    <div
      className="sentence-menu"
      style={{ top: y + 8, left: x }}
      onClick={(e) => e.stopPropagation()}
    >
      <button onClick={onPlay}>▶ 从此句播放</button>
      <button onClick={onNote}>📝 加为笔记</button>
    </div>
  );
}
