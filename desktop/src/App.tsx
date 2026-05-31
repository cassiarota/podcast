import { useEffect, useState } from "react";
import { Library } from "./views/Library";
import { Reader } from "./views/Reader";
import { Settings } from "./views/Settings";
import { JobsBanner } from "./views/JobsBanner";
import { useLibraryStore } from "./state/library";
import { useReaderStore } from "./state/reader";
import { useSettingsStore } from "./state/settings";
import { useTtsSettingsStore } from "./state/tts";

export function App() {
  const refreshBooks = useLibraryStore((s) => s.refresh);
  const openBookId = useReaderStore((s) => s.openBookId);
  const loadSettings = useSettingsStore((s) => s.load);
  const settings = useSettingsStore((s) => s.settings);
  const loadTts = useTtsSettingsStore((s) => s.load);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    refreshBooks();
    loadSettings();
    loadTts();
  }, [refreshBooks, loadSettings, loadTts]);

  useEffect(() => {
    document.body.dataset.theme = settings.background;
    document.documentElement.style.setProperty(
      "--brightness",
      String(settings.brightness)
    );
    document.documentElement.style.setProperty(
      "--font-size",
      computeFontSize(settings.fontSize, settings.fontSizePx)
    );
  }, [settings]);

  return (
    <div className="app" lang={settings.uiLanguage}>
      <JobsBanner />
      {settingsOpen ? (
        <Settings onClose={() => setSettingsOpen(false)} />
      ) : openBookId ? (
        <Reader bookId={openBookId} onOpenSettings={() => setSettingsOpen(true)} />
      ) : (
        <Library onOpenSettings={() => setSettingsOpen(true)} />
      )}
      <div
        className="dim-overlay"
        style={{ opacity: 1 - settings.brightness }}
      />
    </div>
  );
}

/** Custom px override wins; otherwise fall back to the preset. */
function computeFontSize(preset: "small" | "medium" | "large", px: number): string {
  if (px && px > 0) return `${Math.max(8, Math.min(80, px))}px`;
  return preset === "small" ? "16px" : preset === "large" ? "24px" : "19px";
}
