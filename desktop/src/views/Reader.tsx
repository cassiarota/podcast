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
  const stopAudio = usePlayerStore((s) => s.stop);
  const playFromSelection = usePlayerStore((s) => s.playPage);
  const [cursorZone, setCursorZone] = useState<"left" | "center" | "right">("center");
  const [progressOpen, setProgressOpen] = useState(false);
  const [selectionMenu, setSelectionMenu] = useState<SelectionMenuState | null>(null);

  const hideTimerRef = useRef<number | null>(null);

  // Stats: tracks how long this book has been open in the reader.
  useReadingSession(bookId);

  useEffect(() => {
    open(bookId);
  }, [bookId, open]);

  const leaveReader = () => {
    stopAudio();
    close();
  };

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
        else leaveReader();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, prev, controlsVisible, hideControls, stopAudio, close]);

  // Pointer-based gesture handling for the main content area.
  // - When the controls are visible: any pointer up hides them. No page turn.
  // - When hidden:
  //   - "tap" mode: left/right thirds turn pages; center reveals controls.
  //   - "swipe" mode: any drag whose dominant axis exceeds the threshold
  //     turns a page (left/up = next, right/down = prev). Stationary tap
  //     toggles controls.
  const pointerStartRef = useRef<{ x: number; y: number; t: number } | null>(null);

  const handleMainPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (selectionMenu) {
      clearBrowserSelection();
      setSelectionMenu(null);
      pointerStartRef.current = null;
      return;
    }
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

    const selection = window.getSelection();
    const selectedText = selection?.toString().trim() ?? "";
    if (selection && selectedText && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      const sentenceElement = closestSentenceElement(range.startContainer);
      const sentenceIndex = Number(sentenceElement?.dataset.sentenceIndex ?? 0);
      setSelectionMenu({
        text: selectedText,
        sentenceIndex: Number.isFinite(sentenceIndex) ? sentenceIndex : 0,
        x: Math.min(window.innerWidth - 24, Math.max(24, rect.left + rect.width / 2)),
        y: Math.max(16, rect.top - 10),
      });
      return;
    }
    setSelectionMenu(null);
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
    // 2. Recognize swipe — accept either horizontal OR vertical drag whose
    //    magnitude clears the threshold. Whichever axis is larger wins.
    if (settings.pageTurnMode === "swipe") {
      if (controlsVisible) {
        hideControls();
        return;
      }
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
    const rect = target.getBoundingClientRect();
    const x = e.clientX - rect.left;
    if (x < width / 3) prev();
    else if (x > (2 * width) / 3) next();
    else showControls();
  };

  const percent = pageCount > 0 ? Math.round(((pageIndex + 1) / pageCount) * 100) : 0;

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    setCursorZone(x < rect.width / 3 ? "left" : x > (rect.width * 2) / 3 ? "right" : "center");
  };

  return (
    <div
      className={`reader cursor-${cursorZone}`}
      onPointerDown={handleMainPointerDown}
      onPointerUp={handleMainPointerUp}
      onPointerMove={handlePointerMove}
    >
      <SentenceContent />

      <TOC open={tocOpen} onClose={() => setTocOpen(false)} />

      <div
        className={`controls ${controlsVisible ? "" : "hidden"}`}
        onPointerDown={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
      >
        <button onClick={leaveReader}>{t("reader.back")}</button>
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
        <button className="progress-button" onClick={() => setProgressOpen((v) => !v)}>
          {percent}%
        </button>
      </div>

      {/* Always-visible progress badge (works even when controls hidden) */}
      <button
        className={`progress-badge ${controlsVisible ? "with-controls" : ""}`}
        onPointerDown={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
        onClick={() => setProgressOpen((v) => !v)}
      >
        {percent}%
      </button>

      {progressOpen && (
        <ProgressPopover percent={percent} onClose={() => setProgressOpen(false)} />
      )}

      {selectionMenu && page && (
        <SelectionToolbar
          state={selectionMenu}
          onBookmark={async () => {
            await (await import("../lib/api")).api.addNote(
              page.book_id,
              page.id,
              selectionMenu.sentenceIndex,
              selectionMenu.text,
            );
            clearBrowserSelection();
            setSelectionMenu(null);
          }}
          onCopy={async () => {
            await copyText(selectionMenu.text);
            clearBrowserSelection();
            setSelectionMenu(null);
          }}
          onPlay={async () => {
            stopAudio();
            clearBrowserSelection();
            setSelectionMenu(null);
            await playFromSelection(page.book_id, page.id, page.content, selectionMenu.sentenceIndex);
          }}
        />
      )}
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
  const playbackRate = usePlayerStore((s) => s.playbackRate);
  const setPlaybackRate = usePlayerStore((s) => s.setPlaybackRate);

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
          <label className="inline-speed" title={t("settings.reading.playbackSpeed")}>
            <select
              aria-label={t("settings.reading.playbackSpeed")}
              value={playbackRate}
              onChange={(e) => setPlaybackRate(Number(e.target.value))}
            >
              {[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map((rate) => (
                <option key={rate} value={rate}>{rate}×</option>
              ))}
            </select>
          </label>
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
  const sections = useReaderStore((s) => s.sections);
  const playerSentences = usePlayerStore((s) => s.sentences);
  const currentIdx = usePlayerStore((s) => s.currentSentence);
  const playerPageId = usePlayerStore((s) => s.pageId);

  const sectionTitle = useMemo(() => {
    if (!page) return "";
    return sections.find((s) => s.id === page.section_id)?.title.trim() ?? "";
  }, [page, sections]);

  const blocks = useMemo(() => {
    if (!page) return [] as ReaderTextBlock[];
    return buildReaderTextBlocks(page.content, sectionTitle);
  }, [page, sectionTitle]);

  if (!page) return <div className="reader-content" />;

  const isThisPagePlaying = playerPageId === page.id && playerSentences.length > 0;

  return (
    <>
      <div className="reader-content" aria-label={page.section_id || ""}>
        {sectionTitle && (
          <div className="reader-section-title">{sectionTitle}</div>
        )}
        {blocks.length === 0 ? (
          <p className="reader-paragraph">{page.content}</p>
        ) : (
          blocks.map((block) => {
            if (block.kind !== "paragraph") {
              const Tag = block.kind === "heading" ? "h1" : "h2";
              return (
                <Tag key={block.key} className={`reader-${block.kind}`}>
                  {block.text}
                </Tag>
              );
            }
            return (
              <p key={block.key} className="reader-paragraph">
                {block.sentences.map((sentence) => {
                  const active = isThisPagePlaying && sentence.index === currentIdx;
                  const loading = isThisPagePlaying && playerSentences[sentence.index]?.loading;
                  return (
                    <span
                      key={sentence.index}
                      data-sentence-index={sentence.index}
                      className={`sentence ${active ? "sentence-active" : ""} ${loading ? "sentence-loading" : ""}`}
                    >
                      {sentence.text}
                      {" "}
                    </span>
                  );
                })}
              </p>
            );
          })
        )}
      </div>

    </>
  );
}

type ReaderBlockKind = "heading" | "subheading" | "paragraph";

interface ReaderSentence {
  text: string;
  index: number;
}

interface ReaderTextBlock {
  key: string;
  kind: ReaderBlockKind;
  text: string;
  sentences: ReaderSentence[];
}

function buildReaderTextBlocks(content: string, sectionTitle: string): ReaderTextBlock[] {
  let sentenceIndex = 0;
  return content
    .replace(/\r\n?/g, "\n")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((text, lineIndex) => {
      const sentences = splitSentences(text).map((sentence) => ({
        text: sentence,
        index: sentenceIndex++,
      }));
      return {
        key: `${lineIndex}-${text.slice(0, 24)}`,
        kind: classifyReaderBlock(text, sectionTitle),
        text,
        sentences,
      };
    });
}

function classifyReaderBlock(text: string, sectionTitle: string): ReaderBlockKind {
  const trimmed = text.trim();
  if (!trimmed) return "paragraph";
  if (sectionTitle && trimmed === sectionTitle) return "heading";
  if (isChapterLikeHeading(trimmed)) return "heading";
  if (isShortStandaloneHeading(trimmed)) return "subheading";
  return "paragraph";
}

function isChapterLikeHeading(text: string): boolean {
  if (text.length > 90) return false;
  if (/^第[零〇一二三四五六七八九十百千万\d]+[章节回卷篇部]/.test(text)) return true;
  if (/^(序章|序言|序|楔子|尾声|番外|终章|终曲|正文卷|终结|前言|后记|致谢)$/.test(text)) {
    return true;
  }
  if (/^(chapter|part|book|section)\s+[\w\divxlcdm]+/i.test(text)) return true;
  if (/^(prologue|epilogue|introduction|preface|foreword)$/i.test(text)) return true;
  const letters = text.match(/[A-Za-z]/g) ?? [];
  return letters.length >= 2 && !/[a-z]/.test(text);
}

function isShortStandaloneHeading(text: string): boolean {
  if (text.length > 48) return false;
  if (/^[“"「『'（(]/.test(text)) return false;
  if (/[。！？!?；;，,.、：:]$/.test(text)) return false;
  if (/^(作者|译者|编者|导读|摘要|推荐语|第\s*\d+\s*讲)/.test(text)) return true;
  if (/^\d+[\.\-、]\s*\S+/.test(text)) return true;
  if (/^[一二三四五六七八九十]+[、.．]\s*\S+/.test(text)) return true;
  return false;
}

interface SelectionMenuState {
  text: string;
  sentenceIndex: number;
  x: number;
  y: number;
}

function SelectionToolbar({
  state,
  onBookmark,
  onCopy,
  onPlay,
}: {
  state: SelectionMenuState;
  onBookmark: () => Promise<void>;
  onCopy: () => Promise<void>;
  onPlay: () => Promise<void>;
}) {
  return (
    <div
      className="selection-toolbar"
      style={{ left: state.x, top: state.y }}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
    >
      <button onClick={() => void onBookmark()}>🔖 加入书签</button>
      <button onClick={() => void onCopy()}>复制</button>
      <button onClick={() => void onPlay()}>▶ 播放</button>
    </div>
  );
}

function ProgressPopover({ percent, onClose }: { percent: number; onClose: () => void }) {
  const pageCount = useReaderStore((s) => s.pageCount);
  const goTo = useReaderStore((s) => s.goTo);
  const [value, setValue] = useState(percent);

  useEffect(() => setValue(percent), [percent]);

  const jump = async () => {
    const index = Math.round((value / 100) * Math.max(0, pageCount - 1));
    await goTo(index);
  };

  return (
    <div
      className="progress-popover"
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
    >
      <div><strong>{value}%</strong> · 第 {Math.min(pageCount, Math.round((value / 100) * Math.max(0, pageCount - 1)) + 1)} / {pageCount} 页</div>
      <input
        aria-label="阅读进度"
        type="range"
        min="0"
        max="100"
        step="1"
        value={value}
        onChange={(e) => setValue(Number(e.target.value))}
        onPointerUp={() => void jump()}
        onKeyUp={() => void jump()}
      />
      <button onClick={onClose}>完成</button>
    </div>
  );
}

function closestSentenceElement(node: Node): HTMLElement | null {
  const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
  return element?.closest<HTMLElement>("[data-sentence-index]") ?? null;
}

function clearBrowserSelection() {
  window.getSelection()?.removeAllRanges();
}

async function copyText(text: string) {
  const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
  await writeText(text);
}
