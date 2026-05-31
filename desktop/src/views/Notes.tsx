import { useEffect, useMemo, useState } from "react";
import { api, type Note, type NotedBook } from "../lib/api";

interface NotesProps {
  onClose: () => void;
}

export function NotesView({ onClose }: NotesProps) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [books, setBooks] = useState<NotedBook[]>([]);
  const [bookFilter, setBookFilter] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    api.listBooksWithNotes().then(setBooks).catch(() => {});
  }, []);

  useEffect(() => {
    api.listNotes(bookFilter, search || null).then(setNotes).catch(() => {});
  }, [bookFilter, search]);

  const onDelete = async (id: string) => {
    if (!confirm("删除这条笔记？")) return;
    try {
      await api.deleteNote(id);
      setNotes((n) => n.filter((x) => x.id !== id));
      const list = await api.listBooksWithNotes();
      setBooks(list);
    } catch (e) {
      alert(`删除失败: ${e}`);
    }
  };

  return (
    <div className="notes-view">
      <div className="notes-header">
        <button onClick={onClose}>← 返回</button>
        <h1>我的笔记</h1>
        <div style={{ flex: 1 }} />
        <input
          className="notes-search"
          placeholder="搜索文本…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="notes-body">
        <aside className="notes-sidebar">
          <div
            className={`notes-book-row ${bookFilter === null ? "active" : ""}`}
            onClick={() => setBookFilter(null)}
          >
            <span>全部</span>
            <span className="notes-count">
              {books.reduce((a, b) => a + b.note_count, 0)}
            </span>
          </div>
          {books.map((b) => (
            <div
              key={b.book_id || "_"}
              className={`notes-book-row ${bookFilter === b.book_id ? "active" : ""}`}
              onClick={() => setBookFilter(b.book_id || null)}
            >
              <span>{b.title || "未命名"}</span>
              <span className="notes-count">{b.note_count}</span>
            </div>
          ))}
        </aside>

        <main className="notes-list">
          {notes.length === 0 ? (
            <div className="notes-empty">还没有笔记。在阅读页点一句话 → 📝 加为笔记。</div>
          ) : (
            notes.map((n) => (
              <div key={n.id} className="note-card">
                <div className="note-meta">
                  {n.book_title || "未命名"} ·{" "}
                  {new Date(n.created_at * 1000).toLocaleString()}
                </div>
                <div className="note-text">{n.text}</div>
                <div className="note-actions">
                  <button onClick={() => onDelete(n.id)}>删除</button>
                </div>
              </div>
            ))
          )}
        </main>
      </div>
    </div>
  );
}
