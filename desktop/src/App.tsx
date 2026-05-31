import { useEffect } from "react";
import { Library } from "./views/Library";
import { Reader } from "./views/Reader";
import { useLibraryStore } from "./state/library";
import { useReaderStore } from "./state/reader";
import { useSettingsStore } from "./state/settings";

export function App() {
  const refreshBooks = useLibraryStore((s) => s.refresh);
  const openBookId = useReaderStore((s) => s.openBookId);
  const loadSettings = useSettingsStore((s) => s.load);
  const settings = useSettingsStore((s) => s.settings);

  useEffect(() => {
    refreshBooks();
    loadSettings();
  }, [refreshBooks, loadSettings]);

  useEffect(() => {
    document.body.dataset.theme = settings.background;
    document.documentElement.style.setProperty(
      "--brightness",
      String(settings.brightness)
    );
    document.documentElement.style.setProperty(
      "--font-size",
      fontSizePx(settings.fontSize)
    );
  }, [settings]);

  return (
    <div className="app">
      {openBookId ? <Reader bookId={openBookId} /> : <Library />}
      <div
        className="dim-overlay"
        style={{ opacity: 1 - settings.brightness }}
      />
    </div>
  );
}

function fontSizePx(size: "small" | "medium" | "large") {
  return size === "small" ? "16px" : size === "large" ? "24px" : "19px";
}
