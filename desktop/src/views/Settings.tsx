import { useEffect, useMemo } from "react";
import { useSettingsStore } from "../state/settings";
import { useTtsSettingsStore } from "../state/tts";
import { useT, type MessageKey } from "../lib/i18n";

interface SettingsProps {
  onClose: () => void;
}

export function Settings({ onClose }: SettingsProps) {
  const t = useT();
  const reader = useSettingsStore((s) => s.settings);
  const updateReader = useSettingsStore((s) => s.update);
  const tts = useTtsSettingsStore((s) => s.settings);
  const engines = useTtsSettingsStore((s) => s.engines);
  const ttsLoaded = useTtsSettingsStore((s) => s.loaded);
  const loadTts = useTtsSettingsStore((s) => s.load);
  const updateTts = useTtsSettingsStore((s) => s.update);

  useEffect(() => {
    if (!ttsLoaded) loadTts();
  }, [ttsLoaded, loadTts]);

  const currentEngine = useMemo(
    () => engines.find((e) => e.id === tts.engine) ?? engines[0],
    [engines, tts.engine]
  );
  const availableLanguages = currentEngine?.languages ?? [];
  const filteredVoices = useMemo(() => {
    if (!currentEngine) return [];
    if (currentEngine.voices.length === 0) return [];
    return currentEngine.voices.filter(
      (v) =>
        v.language === tts.language ||
        (tts.language.startsWith("en") && v.language.startsWith("en"))
    );
  }, [currentEngine, tts.language]);

  const onEngineChange = (engineId: string) => {
    const next = engines.find((e) => e.id === engineId);
    if (!next) return;
    const voice =
      next.voices.find((v) => v.language === tts.language)?.id ??
      next.voices[0]?.id ??
      tts.voice;
    const language =
      next.languages.find((l) => l.code === tts.language)?.code ??
      next.languages[0]?.code ??
      tts.language;
    updateTts({ engine: engineId, voice, language });
  };
  const onLanguageChange = (lang: string) => {
    if (!currentEngine) return;
    const voice =
      currentEngine.voices.find((v) => v.language === lang)?.id ??
      currentEngine.voices[0]?.id ??
      tts.voice;
    updateTts({ language: lang, voice });
  };

  /**
   * When the user picks a voice directly, sync `language` to match the
   * voice's language metadata. Without this the engine would use the
   * stale language for phonemizing (e.g. English phonemizer on Chinese
   * text → espeak reads every codepoint as "Chinese letter").
   */
  const onVoiceChange = (voiceId: string) => {
    const v = currentEngine?.voices.find((x) => x.id === voiceId);
    if (!v) {
      updateTts({ voice: voiceId });
      return;
    }
    updateTts({ voice: voiceId, language: v.language });
  };

  return (
    <div className="settings-view">
      <div className="settings-header">
        <button onClick={onClose}>{t("settings.back")}</button>
        <h1>{t("settings.title")}</h1>
        <div style={{ flex: 1 }} />
      </div>

      <div className="settings-body">
        {/* Interface */}
        <section className="settings-section">
          <h2>{t("settings.ui")}</h2>
          <Row label={t("settings.uiLanguage")}>
            <select
              value={reader.uiLanguage}
              onChange={(e) =>
                updateReader({ uiLanguage: e.target.value as "zh" | "en" })
              }
            >
              <option value="zh">{t("settings.uiLanguage.zh")}</option>
              <option value="en">{t("settings.uiLanguage.en")}</option>
            </select>
          </Row>
        </section>

        {/* TTS */}
        <section className="settings-section">
          <h2>{t("settings.tts")}</h2>
          <p className="settings-hint">{t("settings.tts.hint")}</p>

          <Row label={t("settings.tts.engine")}>
            <select
              value={tts.engine}
              onChange={(e) => onEngineChange(e.target.value)}
            >
              {engines.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.label}
                </option>
              ))}
            </select>
            {currentEngine && (
              <div className="settings-meta">{currentEngine.description}</div>
            )}
          </Row>

          <Row label={t("settings.tts.language")}>
            <select
              value={tts.language}
              onChange={(e) => onLanguageChange(e.target.value)}
              disabled={availableLanguages.length === 0}
            >
              {availableLanguages.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          </Row>

          <Row label={t("settings.tts.voice")}>
            <select
              value={tts.voice}
              onChange={(e) => onVoiceChange(e.target.value)}
              disabled={filteredVoices.length === 0}
            >
              {filteredVoices.length === 0 && (
                <option value={tts.voice}>{tts.voice}</option>
              )}
              {filteredVoices.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label} ({v.id})
                </option>
              ))}
            </select>
          </Row>

          <Row label={`${t("settings.tts.speed")} ${tts.speed.toFixed(2)}x`}>
            <input
              type="range"
              min="0.5"
              max="1.5"
              step="0.05"
              value={tts.speed}
              onChange={(e) =>
                updateTts({ speed: parseFloat(e.target.value) })
              }
            />
          </Row>

          <Row label={t("settings.tts.preload")}>
            <select
              value={tts.preload ? "on" : "off"}
              onChange={(e) => updateTts({ preload: e.target.value === "on" })}
            >
              <option value="on">{t("settings.tts.preload.on")}</option>
              <option value="off">{t("settings.tts.preload.off")}</option>
            </select>
          </Row>
        </section>

        {/* Storage */}
        <section className="settings-section">
          <h2>{t("settings.storage")}</h2>
          <Row label={t("settings.storage.importsBackup")}>
            <div className="font-px-row">
              <div className="settings-meta" style={{ flex: 1, minWidth: 200 }}>
                {tts.importsBackupDir || t("settings.storage.importsBackup.disabled")}
              </div>
              <button
                type="button"
                className="ghost"
                onClick={async () => {
                  const { open } = await import("@tauri-apps/plugin-dialog");
                  const picked = await open({ directory: true, multiple: false });
                  if (typeof picked === "string") {
                    updateTts({ importsBackupDir: picked });
                  }
                }}
              >
                {t("settings.storage.importsBackup.pick")}
              </button>
              {tts.importsBackupDir && (
                <button
                  type="button"
                  className="ghost"
                  onClick={() => updateTts({ importsBackupDir: null })}
                >
                  {t("settings.storage.importsBackup.clear")}
                </button>
              )}
            </div>
          </Row>
        </section>

        {/* Reading */}
        <section className="settings-section">
          <h2>{t("settings.reading")}</h2>

          <Row label={t("settings.reading.fontSize")}>
            <select
              value={reader.fontSize}
              onChange={(e) =>
                updateReader({
                  fontSize: e.target.value as "small" | "medium" | "large",
                })
              }
            >
              <option value="small">{t("settings.reading.fontSize.small")}</option>
              <option value="medium">{t("settings.reading.fontSize.medium")}</option>
              <option value="large">{t("settings.reading.fontSize.large")}</option>
            </select>
          </Row>

          <Row label={t("settings.reading.fontSizePx")}>
            <div className="font-px-row">
              <input
                type="number"
                min={12}
                max={40}
                step={1}
                value={reader.fontSizePx || ""}
                placeholder={t("settings.reading.fontSizePx.usePreset")}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  updateReader({ fontSizePx: Number.isFinite(v) ? v : 0 });
                }}
              />
              <input
                type="range"
                min={12}
                max={40}
                step={1}
                value={reader.fontSizePx || 19}
                onChange={(e) => updateReader({ fontSizePx: parseInt(e.target.value, 10) })}
              />
              {reader.fontSizePx > 0 && (
                <button
                  type="button"
                  className="ghost"
                  onClick={() => updateReader({ fontSizePx: 0 })}
                >
                  {t("settings.reading.fontSizePx.usePreset")}
                </button>
              )}
            </div>
          </Row>

          <Row label={t("settings.reading.theme")}>
            <select
              value={reader.background}
              onChange={(e) => updateReader({ background: e.target.value })}
            >
              {(
                [
                  "white",
                  "warm-paper",
                  "sepia",
                  "eye-protect-green",
                  "gray",
                  "low-contrast",
                  "cool-paper",
                  "rose",
                  "dark",
                  "black",
                ] as const
              ).map((id) => (
                <option key={id} value={id}>
                  {t(`theme.${id}` as MessageKey)}
                </option>
              ))}
            </select>
          </Row>

          <Row label={`${t("settings.reading.brightness")} ${(reader.brightness * 100).toFixed(0)}%`}>
            <input
              type="range"
              min="0.3"
              max="1"
              step="0.05"
              value={reader.brightness}
              onChange={(e) =>
                updateReader({ brightness: parseFloat(e.target.value) })
              }
            />
          </Row>

          <Row label={t("settings.reading.pageTurnMode")}>
            <select
              value={reader.pageTurnMode}
              onChange={(e) =>
                updateReader({
                  pageTurnMode: e.target.value as "tap" | "swipe",
                })
              }
            >
              <option value="tap">{t("settings.reading.pageTurnMode.tap")}</option>
              <option value="swipe">{t("settings.reading.pageTurnMode.swipe")}</option>
            </select>
          </Row>

          <Row label={t("settings.reading.menuAutoHide")}>
            <select
              value={reader.menuAutoHide ? "on" : "off"}
              onChange={(e) =>
                updateReader({ menuAutoHide: e.target.value === "on" })
              }
            >
              <option value="off">{t("settings.reading.menuAutoHide.off")}</option>
              <option value="on">{t("settings.reading.menuAutoHide.on")}</option>
            </select>
          </Row>
        </section>

        <section className="settings-section">
          <h2>{t("settings.about")}</h2>
          <div className="settings-meta">{t("settings.about.kokoroNote")}</div>
        </section>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="settings-row">
      <label>{label}</label>
      <div className="settings-control">{children}</div>
    </div>
  );
}
