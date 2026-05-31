import { useEffect, useMemo } from "react";
import { useSettingsStore } from "../state/settings";
import { useTtsSettingsStore } from "../state/tts";

interface SettingsProps {
  onClose: () => void;
}

export function Settings({ onClose }: SettingsProps) {
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
        // Treat "en" and "en-GB" as compatible with each other for filtering UX.
        (tts.language.startsWith("en") && v.language.startsWith("en"))
    );
  }, [currentEngine, tts.language]);

  const onEngineChange = (engineId: string) => {
    const next = engines.find((e) => e.id === engineId);
    if (!next) return;
    // Pick the first voice that matches the saved language; fall back to the
    // first voice the engine ships.
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

  return (
    <div className="settings-view">
      <div className="settings-header">
        <button onClick={onClose}>← 返回</button>
        <h1>设置</h1>
        <div style={{ flex: 1 }} />
      </div>

      <div className="settings-body">
        <section className="settings-section">
          <h2>语音生成</h2>
          <p className="settings-hint">
            选择 TTS 引擎、音色、语言和语速。设置随时生效，下次播放即用。
          </p>

          <Row label="引擎">
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

          <Row label="语言">
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

          <Row label="音色">
            <select
              value={tts.voice}
              onChange={(e) => updateTts({ voice: e.target.value })}
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

          <Row label={`语速 ${tts.speed.toFixed(2)}x`}>
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
        </section>

        <section className="settings-section">
          <h2>阅读</h2>

          <Row label="字号">
            <select
              value={reader.fontSize}
              onChange={(e) =>
                updateReader({
                  fontSize: e.target.value as "small" | "medium" | "large",
                })
              }
            >
              <option value="small">小</option>
              <option value="medium">中</option>
              <option value="large">大</option>
            </select>
          </Row>

          <Row label="主题">
            <select
              value={reader.background}
              onChange={(e) => updateReader({ background: e.target.value })}
            >
              <option value="white">白</option>
              <option value="warm-paper">暖纸</option>
              <option value="sepia">古书</option>
              <option value="eye-protect-green">护眼绿</option>
              <option value="gray">中灰</option>
              <option value="low-contrast">低对比</option>
              <option value="cool-paper">冷纸</option>
              <option value="rose">玫瑰</option>
              <option value="dark">深色</option>
              <option value="black">纯黑</option>
            </select>
          </Row>

          <Row label={`亮度 ${(reader.brightness * 100).toFixed(0)}%`}>
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
        </section>

        <section className="settings-section">
          <h2>关于</h2>
          <div className="settings-meta">
            Kokoro 支持 9 种语言（含中文 Mandarin）。Windows 用户如果不想配置
            CUDA，建议直接选 Kokoro。
          </div>
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
