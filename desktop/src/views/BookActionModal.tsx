import { useEffect, useState } from "react";
import { useLibraryStore } from "../state/library";
import { api, type Book, type Section } from "../lib/api";
import { format, useT } from "../lib/i18n";
import { useSettingsStore } from "../state/settings";
import { translate } from "../lib/i18n";

interface BookActionModalProps {
  book: Book;
  onClose: () => void;
}

export function BookActionModal({ book, onClose }: BookActionModalProps) {
  const t = useT();
  const lang = useSettingsStore((s) => s.settings.uiLanguage);
  const deleteBook = useLibraryStore((s) => s.deleteBook);
  const [sections, setSections] = useState<Section[] | null>(null);
  const [tocOpen, setTocOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.openBook(book.id).then((r) => setSections(r.sections)).catch(() => setSections([]));
  }, [book.id]);

  const onGenerateWhole = async () => {
    if (!confirm(format(t("library.generateConfirm"), { title: book.title }))) return;
    setBusy(true);
    try {
      await api.startTtsJob(book.id, "whole_book", "");
      alert(format(t("library.jobStarted"), { title: book.title }));
      onClose();
    } catch (e) {
      alert(`${t("reader.ttsErrorTitle")}: ${e}`);
    } finally {
      setBusy(false);
    }
  };

  const onGenerateSection = async (s: Section) => {
    setBusy(true);
    try {
      await api.startTtsJob(book.id, `section:${s.id}`, "");
      alert(format(t("library.jobStarted"), { title: s.title || `Section ${s.ord + 1}` }));
    } catch (e) {
      alert(`${t("reader.ttsErrorTitle")}: ${e}`);
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async () => {
    if (!confirm(format(t("library.deleteConfirm"), { title: book.title }))) return;
    setBusy(true);
    try {
      await deleteBook(book.id);
      onClose();
    } catch (e) {
      alert(`${e}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{book.title}</h2>
          {book.author && <div className="modal-meta">{book.author}</div>}
          <div className="modal-meta">
            {book.source_format.toUpperCase()} · {translate(lang as "zh" | "en", "library.toc")}{" "}
            {sections ? `(${sections.length})` : ""}
          </div>
        </div>

        <div className="modal-actions">
          <button className="primary" onClick={onGenerateWhole} disabled={busy}>
            ▶ {t("library.actions.generateAudio")}
          </button>
          <button onClick={() => setTocOpen((v) => !v)} disabled={busy}>
            {t("library.actions.viewToc")}
          </button>
          <div className="modal-actions-spacer" />
          <button className="danger" onClick={onDelete} disabled={busy}>
            {t("library.actions.delete")}
          </button>
          <button onClick={onClose} disabled={busy}>
            {t("library.actions.close")}
          </button>
        </div>

        {tocOpen && (
          <div className="modal-toc">
            {sections == null && <div className="modal-meta">…</div>}
            {sections && sections.length === 0 && (
              <div className="modal-meta">— —</div>
            )}
            {sections?.map((s) => (
              <div key={s.id} className="modal-toc-row">
                <div className="modal-toc-title">
                  {s.title || `Section ${s.ord + 1}`}
                </div>
                <button onClick={() => onGenerateSection(s)} disabled={busy}>
                  {t("library.generateThisChapter")}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
