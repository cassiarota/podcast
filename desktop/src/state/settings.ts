import { create } from "zustand";
import { api, type ReaderSettings } from "../lib/api";

interface SettingsState {
  settings: ReaderSettings;
  load: () => Promise<void>;
  update: (patch: Partial<ReaderSettings>) => Promise<void>;
}

const defaults: ReaderSettings = {
  fontSize: "medium",
  fontSizePx: 0,
  background: "warm-paper",
  brightness: 1,
  uiLanguage: "zh",
  pageTurnMode: "tap",
  menuAutoHide: false,
};

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: defaults,
  load: async () => {
    try {
      const s = await api.getReaderSettings();
      set({ settings: { ...defaults, ...s } });
    } catch {
      // first run — keep defaults
    }
  },
  update: async (patch) => {
    const next = { ...get().settings, ...patch };
    set({ settings: next });
    await api.saveReaderSettings(next);
  },
}));
