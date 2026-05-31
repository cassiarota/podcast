import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useLibraryStore } from "../state/library";
import { useReaderStore } from "../state/reader";

export function Library() {
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
      alert(`Import failed: ${e}`);
    }
  };

  return (
    <div className="library">
      <h1>Library</h1>
      {books.length === 0 && (
        <div className="empty-shelf">
          Your shelf is empty. Tap <em>Import a book</em> to begin.
        </div>
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
          + Import a book
        </div>
      </div>
    </div>
  );
}
