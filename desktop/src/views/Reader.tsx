import { useEffect, useRef, useState } from "react";
import { useReaderStore } from "../state/reader";
import { useSettingsStore } from "../state/settings";
import { TOC } from "./TOC";

const HIDE_DELAY_MS = 2200;

interface ReaderProps {
  bookId: string;
}

export function Reader({ bookId }: ReaderProps) {
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
  const tocOpen = useReaderStore((s) => s.tocOpen);
  const setTocOpen = useReaderStore((s) => s.setTocOpen);
  const settings = useSettingsStore((s) => s.settings);
  const updateSettings = useSettingsStore((s) => s.update);

  const hideTimerRef = useRef<number | null>(null);

  useEffect(() => {
    open(bookId);
  }, [bookId, open]);

  useEffect(() => {
    if (!controlsVisible) return;
    if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = window.setTimeout(hideControls, HIDE_DELAY_MS);
    return () => {
      if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    };
  }, [controlsVisible, hideControls, pageIndex]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") prev();
      else if (e.key === "ArrowRight") next();
      else if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, prev, close]);

  const percent = pageCount > 0 ? Math.round(((pageIndex + 1) / pageCount) * 100) : 0;

  return (
    <div className="reader">
      <div className="reader-content">{page?.content ?? ""}</div>
      <div className="tap-regions">
        <div className="tap" onClick={prev} aria-label="previous" />
        <div className="tap" onClick={toggleControls} aria-label="toggle controls" />
        <div className="tap" onClick={next} aria-label="next" />
      </div>
      <TOC open={tocOpen} onClose={() => setTocOpen(false)} />
      <div className={`controls ${controlsVisible ? "" : "hidden"}`}>
        <button onClick={close}>← Library</button>
        <button onClick={() => setTocOpen(true)}>Contents</button>
        <label>
          Font
          <select
            value={settings.fontSize}
            onChange={(e) =>
              updateSettings({ fontSize: e.target.value as "small" | "medium" | "large" })
            }
            style={{ marginLeft: 6 }}
          >
            <option value="small">S</option>
            <option value="medium">M</option>
            <option value="large">L</option>
          </select>
        </label>
        <label>
          Theme
          <select
            value={settings.background}
            onChange={(e) => updateSettings({ background: e.target.value })}
            style={{ marginLeft: 6 }}
          >
            <option value="white">White</option>
            <option value="warm-paper">Warm Paper</option>
            <option value="sepia">Sepia</option>
            <option value="eye-protect-green">Eye-Protect Green</option>
            <option value="gray">Gray</option>
            <option value="low-contrast">Low Contrast</option>
            <option value="cool-paper">Cool Paper</option>
            <option value="rose">Rose</option>
            <option value="dark">Dark</option>
            <option value="black">Black</option>
          </select>
        </label>
        <label>
          Brightness
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
    </div>
  );
}

function PlayButton() {
  const page = useReaderStore((s) => s.currentPage);
  const [busy, setBusy] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  if (!page) return null;
  return (
    <>
      <button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const { api } = await import("../lib/api");
            const chunk = await api.playCachedOrGenerate(
              page.book_id,
              page.id,
              "default"
            );
            const { convertFileSrc } = await import("@tauri-apps/api/core");
            const url = convertFileSrc(chunk.path);
            if (!audioRef.current) audioRef.current = new Audio();
            audioRef.current.src = url;
            await audioRef.current.play();
          } catch (e) {
            console.error("playback failed", e);
            alert(`Playback failed: ${e}`);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "…" : "▶ Play"}
      </button>
    </>
  );
}
