import { useEffect, useState } from "react";
import { useReaderStore } from "../state/reader";
import { useT } from "../lib/i18n";
import { api, type Note } from "../lib/api";

interface TOCProps {
  open: boolean;
  onClose: () => void;
}

export function TOC({ open, onClose }: TOCProps) {
  const t = useT();
  const sections = useReaderStore((s) => s.sections);
  const openBookId = useReaderStore((s) => s.openBookId);
  const goTo = useReaderStore((s) => s.goTo);
  const [tab, setTab] = useState<"contents" | "bookmarks">("contents");
  const [bookmarks, setBookmarks] = useState<Note[]>([]);

  useEffect(() => {
    if (!open || !openBookId) return;
    api.listNotes(openBookId, null).then(setBookmarks).catch((e) =>
      console.error("bookmark list failed", e),
    );
  }, [open, openBookId, tab]);

  const jumpToSection = async (sectionId: string) => {
    if (!openBookId) return;
    try {
      const idx = await api.firstPageOfSection(openBookId, sectionId);
      await goTo(idx);
    } catch (e) {
      console.error("section jump failed", e);
    }
    onClose();
  };

  const jumpToBookmark = async (bookmark: Note) => {
    if (bookmark.page_index == null) return;
    await goTo(bookmark.page_index);
    onClose();
  };

  return (
    <div
      className={`toc ${open ? "open" : ""}`}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
    >
      <div className="toc-header">
        <button className={tab === "contents" ? "active" : ""} onClick={() => setTab("contents")}>
          {t("reader.contents")}
        </button>
        <button className={tab === "bookmarks" ? "active" : ""} onClick={() => setTab("bookmarks")}>
          🔖 书签列表
        </button>
      </div>
      {tab === "contents" ? (
        <ul>
          {sections.map((s) => (
            <li key={s.id} onClick={() => jumpToSection(s.id)}>
              {s.title || `Section ${s.ord + 1}`}
            </li>
          ))}
        </ul>
      ) : (
        <ul className="bookmark-list">
          {bookmarks.length === 0 ? (
            <li className="bookmark-empty">还没有书签</li>
          ) : bookmarks.map((bookmark) => (
            <li key={bookmark.id} onClick={() => void jumpToBookmark(bookmark)}>
              <span>{bookmark.text}</span>
              {bookmark.page_index != null && <small>第 {bookmark.page_index + 1} 页</small>}
            </li>
          ))}
        </ul>
      )}
      {/* Thin collapse rail on the right edge — click to close. */}
      <button
        className="toc-collapse"
        aria-label={t("reader.contents")}
        title={t("reader.contents")}
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      >
        ‹
      </button>
    </div>
  );
}
