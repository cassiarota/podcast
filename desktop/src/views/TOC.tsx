import { useReaderStore } from "../state/reader";
import { useT } from "../lib/i18n";
import { api } from "../lib/api";

interface TOCProps {
  open: boolean;
  onClose: () => void;
}

export function TOC({ open, onClose }: TOCProps) {
  const t = useT();
  const sections = useReaderStore((s) => s.sections);
  const openBookId = useReaderStore((s) => s.openBookId);
  const goTo = useReaderStore((s) => s.goTo);

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

  return (
    <div className={`toc ${open ? "open" : ""}`}>
      <div className="toc-header">
        <h3>{t("reader.contents")}</h3>
      </div>
      <ul>
        {sections.map((s) => (
          <li key={s.id} onClick={() => jumpToSection(s.id)}>
            {s.title || `Section ${s.ord + 1}`}
          </li>
        ))}
      </ul>
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
