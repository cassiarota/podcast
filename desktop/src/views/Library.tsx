import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useLibraryStore } from "../state/library";
import { useReaderStore } from "../state/reader";
import { useT } from "../lib/i18n";

interface LibraryProps {
  onOpenSettings: () => void;
}

export function Library({ onOpenSettings }: LibraryProps) {
  const t = useT();
  const books = useLibraryStore((s) => s.books);
  const importBook = useLibraryStore((s) => s.importBook);
  const openBook = useReaderStore((s) => s.open);

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

  return (
    <div className="library">
      <div className="library-header">
        <h1>{t("library.title")}</h1>
        <button className="settings-button" onClick={onOpenSettings} title={t("reader.settings")}>
          {t("reader.settings")}
        </button>
      </div>
      {books.length === 0 && (
        <div className="empty-shelf">{t("library.empty")}</div>
      )}
      <div className="shelf">
        {books.map((b) => (
          <div
            key={b.id}
            className="book-tile"
            onClick={() => openBook(b.id)}
            title={b.title}
          >
            <div className="title">{b.title}</div>
            {b.author && <div className="author">{b.author}</div>}
          </div>
        ))}
        <div className="import-tile" onClick={onImport}>
          {t("library.import")}
        </div>
      </div>
    </div>
  );
}
