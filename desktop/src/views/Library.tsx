import { useRef, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useLibraryStore } from "../state/library";
import { useReaderStore } from "../state/reader";
import { useJobsStore } from "../state/jobs";
import { type Book } from "../lib/api";
import { format, useT } from "../lib/i18n";
import { BookActionModal } from "./BookActionModal";

interface LibraryProps {
  onOpenSettings: () => void;
}

const LONG_PRESS_MS = 500;

export function Library({ onOpenSettings }: LibraryProps) {
  const t = useT();
  const books = useLibraryStore((s) => s.books);
  const importBook = useLibraryStore((s) => s.importBook);
  const selectMode = useLibraryStore((s) => s.selectMode);
  const selectedIds = useLibraryStore((s) => s.selectedIds);
  const setSelectMode = useLibraryStore((s) => s.setSelectMode);
  const toggleSelected = useLibraryStore((s) => s.toggleSelected);
  const clearSelected = useLibraryStore((s) => s.clearSelected);
  const deleteBooks = useLibraryStore((s) => s.deleteBooks);
  const enqueueBooks = useJobsStore((s) => s.enqueueBooks);
  const openBook = useReaderStore((s) => s.open);
  const [actionBook, setActionBook] = useState<Book | null>(null);

  const onImport = async () => {
    const selected = await openDialog({
      multiple: false,
      filters: [
        { name: "Books", extensions: ["txt", "epub"] },
        { name: "All", extensions: ["*"] },
      ],
    });
    if (!selected) return;
    const path = Array.isArray(selected) ? selected[0] : selected;
    if (!path) return;
    try {
      await importBook(path, false);
    } catch (e) {
      console.error("import failed", e);
      alert(`${t("library.importFailed")}: ${e}`);
    }
  };

  const onBatchGenerate = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    // Don't fire-and-forget — enqueue to the jobs panel so the user can
    // tweak chapters per book before actually kicking off generation.
    const picked: Book[] = books.filter((b) => ids.includes(b.id));
    await enqueueBooks(picked);
    clearSelected();
    setSelectMode(false);
  };

  const onBatchDelete = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    if (!confirm(format(t("library.deleteConfirmPlural"), { n: ids.length }))) return;
    await deleteBooks(ids);
  };

  return (
    <div className="library">
      <div className="library-header">
        <h1>{t("library.title")}</h1>
        {selectMode ? (
          <button className="settings-button" onClick={() => setSelectMode(false)}>
            {t("library.selectExit")}
          </button>
        ) : (
          <button className="settings-button" onClick={() => setSelectMode(true)}>
            {t("library.select")}
          </button>
        )}
        <button className="settings-button" onClick={onOpenSettings} title={t("reader.settings")}>
          {t("reader.settings")}
        </button>
      </div>
      {books.length === 0 && (
        <div className="empty-shelf">{t("library.empty")}</div>
      )}
      {books.length > 0 && (
        <div className="library-hint">{t("library.longPressHint")}</div>
      )}
      <div className="shelf">
        {books.map((b) => (
          <BookTile
            key={b.id}
            book={b}
            isSelected={selectedIds.has(b.id)}
            selectMode={selectMode}
            onPrimary={() => {
              if (selectMode) toggleSelected(b.id);
              else openBook(b.id);
            }}
            onLongPress={() => setActionBook(b)}
          />
        ))}
        <div className="import-tile" onClick={onImport}>
          {t("library.import")}
        </div>
      </div>

      {selectMode && selectedIds.size > 0 && (
        <div className="batch-bar">
          <div className="batch-count">
            {format(t("library.selected"), { n: selectedIds.size })}
          </div>
          <div style={{ flex: 1 }} />
          <button className="primary" onClick={onBatchGenerate}>
            ▶ {format(t("library.batchGenerate"), { n: selectedIds.size })}
          </button>
          <button className="danger" onClick={onBatchDelete}>
            {format(t("library.batchDelete"), { n: selectedIds.size })}
          </button>
        </div>
      )}

      {actionBook && <BookActionModal book={actionBook} onClose={() => setActionBook(null)} />}
    </div>
  );
}

interface BookTileProps {
  book: Book;
  isSelected: boolean;
  selectMode: boolean;
  onPrimary: () => void;
  onLongPress: () => void;
}

function BookTile({ book, isSelected, selectMode, onPrimary, onLongPress }: BookTileProps) {
  const timerRef = useRef<number | null>(null);
  const firedRef = useRef(false);

  const start = () => {
    firedRef.current = false;
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      firedRef.current = true;
      onLongPress();
    }, LONG_PRESS_MS);
  };
  const cancel = () => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };
  const end = () => {
    cancel();
    if (!firedRef.current) onPrimary();
  };

  return (
    <div
      className={`book-tile ${isSelected ? "selected" : ""}`}
      title={book.title}
      onPointerDown={start}
      onPointerUp={end}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onContextMenu={(e) => {
        e.preventDefault();
        onLongPress();
      }}
    >
      {selectMode && (
        <div className={`book-checkbox ${isSelected ? "checked" : ""}`}>
          {isSelected ? "✓" : ""}
        </div>
      )}
      <div className="title">{book.title}</div>
      {book.author && <div className="author">{book.author}</div>}
    </div>
  );
}
