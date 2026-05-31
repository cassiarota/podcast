import { create } from "zustand";
import { api, type TtsSettings, type EngineInfo } from "../lib/api";

interface TtsSettingsState {
  settings: TtsSettings;
  engines: EngineInfo[];
  loaded: boolean;
  load: () => Promise<void>;
  update: (patch: Partial<TtsSettings>) => Promise<void>;
}

const defaults: TtsSettings = {
  engine: "kokoro",
  voice: "af_heart",
  language: "en",
  speed: 1.0,
};

export const useTtsSettingsStore = create<TtsSettingsState>((set, get) => ({
  settings: defaults,
  engines: [],
  loaded: false,
  load: async () => {
    try {
      const [s, engines] = await Promise.all([
        api.getTtsSettings(),
        api.listEngines(),
      ]);
      set({ settings: { ...defaults, ...s }, engines, loaded: true });
    } catch (e) {
      console.error("loadTtsSettings failed", e);
      set({ loaded: true });
    }
  },
  update: async (patch) => {
    const next = { ...get().settings, ...patch };
    set({ settings: next });
    await api.saveTtsSettings(next);
  },
}));
