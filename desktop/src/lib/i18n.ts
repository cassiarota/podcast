/**
 * Tiny i18n layer.
 *
 * Single source of truth for app-chrome strings. Pick the locale from
 * `useSettingsStore().settings.uiLanguage`; falls back to Chinese.
 *
 * Convention: keep keys in dotted lower-case English. Adding a key requires
 * adding both Chinese and English entries — the type system enforces this
 * via the `Messages` record.
 */
export type Locale = "zh" | "en";

interface Messages {
  // Library
  "library.title": string;
  "library.import": string;
  "library.empty": string;
  "library.importFailed": string;
  "library.select": string;
  "library.selectExit": string;
  "library.selected": string;
  "library.actions.generateAudio": string;
  "library.actions.delete": string;
  "library.actions.viewToc": string;
  "library.actions.close": string;
  "library.actions.cancel": string;
  "library.deleteConfirm": string;
  "library.deleteConfirmPlural": string;
  "library.generateConfirm": string;
  "library.generateConfirmPlural": string;
  "library.bookActions": string;
  "library.longPressHint": string;
  "library.batchGenerate": string;
  "library.batchDelete": string;
  "library.toc": string;
  "library.generateThisChapter": string;
  "library.jobStarted": string;
  "library.jobProgress": string;
  "library.jobDone": string;

  // Reader
  "reader.back": string;
  "reader.contents": string;
  "reader.settings": string;
  "reader.play": string;
  "reader.pause": string;
  "reader.resume": string;
  "reader.stop": string;
  "reader.busy": string;
  "reader.previous": string;
  "reader.next": string;
  "reader.toggleControls": string;
  "reader.ttsErrorTitle": string;
  "reader.ok": string;

  // Jobs panel
  "jobs.button": string;
  "jobs.title": string;
  "jobs.openPanel": string;
  "jobs.empty": string;
  "jobs.pending": string;
  "jobs.active": string;
  "jobs.done": string;
  "jobs.startAll": string;
  "jobs.startSelected": string;
  "jobs.startWhole": string;
  "jobs.selectAll": string;
  "jobs.selectNone": string;
  "jobs.chaptersSelected": string;
  "jobs.loadingChapters": string;

  // Settings page
  "settings.title": string;
  "settings.back": string;
  "settings.ui": string;
  "settings.uiLanguage": string;
  "settings.uiLanguage.zh": string;
  "settings.uiLanguage.en": string;
  "settings.tts": string;
  "settings.tts.hint": string;
  "settings.tts.engine": string;
  "settings.tts.language": string;
  "settings.tts.voice": string;
  "settings.tts.speed": string;
  "settings.tts.preload": string;
  "settings.tts.preload.on": string;
  "settings.tts.preload.off": string;
  "settings.storage": string;
  "settings.storage.importsBackup": string;
  "settings.storage.importsBackup.pick": string;
  "settings.storage.importsBackup.disabled": string;
  "settings.storage.importsBackup.clear": string;
  "settings.reading": string;
  "settings.reading.fontSize": string;
  "settings.reading.fontSize.small": string;
  "settings.reading.fontSize.medium": string;
  "settings.reading.fontSize.large": string;
  "settings.reading.fontSizePx": string;
  "settings.reading.fontSizePx.usePreset": string;
  "settings.reading.theme": string;
  "settings.reading.brightness": string;
  "settings.reading.pageTurnMode": string;
  "settings.reading.pageTurnMode.tap": string;
  "settings.reading.pageTurnMode.swipe": string;
  "settings.reading.menuAutoHide": string;
  "settings.reading.menuAutoHide.on": string;
  "settings.reading.menuAutoHide.off": string;
  "settings.about": string;
  "settings.about.kokoroNote": string;

  // Themes
  "theme.white": string;
  "theme.warm-paper": string;
  "theme.sepia": string;
  "theme.eye-protect-green": string;
  "theme.gray": string;
  "theme.low-contrast": string;
  "theme.cool-paper": string;
  "theme.rose": string;
  "theme.dark": string;
  "theme.black": string;
}

const ZH: Messages = {
  "library.title": "书架",
  "library.import": "+ 导入书籍",
  "library.empty": "书架空空如也。点击下方导入按钮开始阅读。",
  "library.importFailed": "导入失败",
  "library.select": "批量",
  "library.selectExit": "取消批量",
  "library.selected": "已选 {n}",
  "library.actions.generateAudio": "生成整本书音频",
  "library.actions.delete": "删除书籍",
  "library.actions.viewToc": "查看目录",
  "library.actions.close": "关闭",
  "library.actions.cancel": "取消",
  "library.deleteConfirm": "确认删除「{title}」？已生成的音频缓存会一并清掉。",
  "library.deleteConfirmPlural": "确认删除 {n} 本书？已生成的音频缓存会一并清掉。",
  "library.generateConfirm": "开始为「{title}」生成整本书音频？需要一些时间。",
  "library.generateConfirmPlural": "开始为这 {n} 本书生成整本书音频？需要较长时间。",
  "library.bookActions": "书籍操作",
  "library.longPressHint": "长按书籍查看更多操作",
  "library.batchGenerate": "生成所选 {n} 本",
  "library.batchDelete": "删除所选 {n} 本",
  "library.toc": "目录",
  "library.generateThisChapter": "生成本章",
  "library.jobStarted": "已开始生成「{title}」",
  "library.jobProgress": "{title}：{percent}%",
  "library.jobDone": "「{title}」生成完成",

  "reader.back": "← 书架",
  "reader.contents": "目录",
  "reader.settings": "⚙ 设置",
  "reader.play": "▶ 播放",
  "reader.pause": "暂停",
  "reader.resume": "继续",
  "reader.stop": "停止",
  "reader.busy": "…",
  "reader.previous": "上一页",
  "reader.next": "下一页",
  "reader.toggleControls": "显示/隐藏控件",
  "reader.ttsErrorTitle": "音频生成失败",
  "reader.ok": "好",

  "jobs.button": "▶ 任务 ({n})",
  "jobs.title": "音频生成任务",
  "jobs.openPanel": "打开任务面板",
  "jobs.empty": "暂无任务。",
  "jobs.pending": "待开始",
  "jobs.active": "生成中",
  "jobs.done": "已完成",
  "jobs.startAll": "开始全部 ({n})",
  "jobs.startSelected": "生成所选 {n} 章",
  "jobs.startWhole": "生成整本书",
  "jobs.selectAll": "全选",
  "jobs.selectNone": "全不选",
  "jobs.chaptersSelected": "已选 {sel} / {total} 章",
  "jobs.loadingChapters": "正在加载目录…",

  "settings.title": "设置",
  "settings.back": "← 返回",
  "settings.ui": "界面",
  "settings.uiLanguage": "界面语言",
  "settings.uiLanguage.zh": "中文",
  "settings.uiLanguage.en": "English",
  "settings.tts": "语音生成",
  "settings.tts.hint": "选择 TTS 引擎、音色、语言和语速。设置随时生效，下次播放即用。",
  "settings.tts.engine": "引擎",
  "settings.tts.language": "语言",
  "settings.tts.voice": "音色",
  "settings.tts.speed": "语速",
  "settings.tts.preload": "启动预热",
  "settings.tts.preload.on": "应用启动时静默预加载（推荐）",
  "settings.tts.preload.off": "首次播放时再加载",
  "settings.storage": "存储",
  "settings.storage.importsBackup": "导入备份目录",
  "settings.storage.importsBackup.pick": "选择目录…",
  "settings.storage.importsBackup.disabled": "（未设置 — 不保存额外副本）",
  "settings.storage.importsBackup.clear": "清除",
  "settings.reading": "阅读",
  "settings.reading.fontSize": "字号档位",
  "settings.reading.fontSize.small": "小",
  "settings.reading.fontSize.medium": "中",
  "settings.reading.fontSize.large": "大",
  "settings.reading.fontSizePx": "自定义字号 (px)",
  "settings.reading.fontSizePx.usePreset": "使用上方档位",
  "settings.reading.theme": "主题",
  "settings.reading.brightness": "亮度",
  "settings.reading.pageTurnMode": "翻页方式",
  "settings.reading.pageTurnMode.tap": "点击区域翻页",
  "settings.reading.pageTurnMode.swipe": "滑动翻页",
  "settings.reading.menuAutoHide": "菜单自动隐藏",
  "settings.reading.menuAutoHide.on": "2 秒后自动隐藏",
  "settings.reading.menuAutoHide.off": "点击外部区域才隐藏",
  "settings.about": "关于",
  "settings.about.kokoroNote": "Kokoro 支持 9 种语言（含中文 Mandarin）。Windows 用户如果不想配置 CUDA，建议直接选 Kokoro。",

  "theme.white": "白",
  "theme.warm-paper": "暖纸",
  "theme.sepia": "古书",
  "theme.eye-protect-green": "护眼绿",
  "theme.gray": "中灰",
  "theme.low-contrast": "低对比",
  "theme.cool-paper": "冷纸",
  "theme.rose": "玫瑰",
  "theme.dark": "深色",
  "theme.black": "纯黑",
};

const EN: Messages = {
  "library.title": "Library",
  "library.import": "+ Import a book",
  "library.empty": "Your shelf is empty. Tap the import button below to begin.",
  "library.importFailed": "Import failed",
  "library.select": "Select",
  "library.selectExit": "Cancel select",
  "library.selected": "{n} selected",
  "library.actions.generateAudio": "Generate audio for whole book",
  "library.actions.delete": "Delete book",
  "library.actions.viewToc": "View contents",
  "library.actions.close": "Close",
  "library.actions.cancel": "Cancel",
  "library.deleteConfirm": "Delete \"{title}\"? All cached audio for this book will be removed too.",
  "library.deleteConfirmPlural": "Delete {n} books? All cached audio for these books will be removed too.",
  "library.generateConfirm": "Generate audio for the whole book \"{title}\"? This can take a while.",
  "library.generateConfirmPlural": "Generate audio for {n} whole books? This will take a long time.",
  "library.bookActions": "Book actions",
  "library.longPressHint": "Long-press a book for more actions",
  "library.batchGenerate": "Generate audio for {n} selected",
  "library.batchDelete": "Delete {n} selected",
  "library.toc": "Contents",
  "library.generateThisChapter": "Generate chapter",
  "library.jobStarted": "Started generating \"{title}\"",
  "library.jobProgress": "{title}: {percent}%",
  "library.jobDone": "\"{title}\" generation complete",

  "reader.back": "← Library",
  "reader.contents": "Contents",
  "reader.settings": "⚙ Settings",
  "reader.play": "▶ Play",
  "reader.pause": "Pause",
  "reader.resume": "Resume",
  "reader.stop": "Stop",
  "reader.busy": "…",
  "reader.previous": "previous page",
  "reader.next": "next page",
  "reader.toggleControls": "toggle controls",
  "reader.ttsErrorTitle": "TTS failed",
  "reader.ok": "OK",

  "jobs.button": "▶ Tasks ({n})",
  "jobs.title": "Audio generation tasks",
  "jobs.openPanel": "Open tasks panel",
  "jobs.empty": "No tasks.",
  "jobs.pending": "Pending",
  "jobs.active": "Running",
  "jobs.done": "Completed",
  "jobs.startAll": "Start all ({n})",
  "jobs.startSelected": "Generate {n} chapters",
  "jobs.startWhole": "Generate whole book",
  "jobs.selectAll": "Select all",
  "jobs.selectNone": "Select none",
  "jobs.chaptersSelected": "{sel} / {total} chapters selected",
  "jobs.loadingChapters": "Loading TOC…",

  "settings.title": "Settings",
  "settings.back": "← Back",
  "settings.ui": "Interface",
  "settings.uiLanguage": "Interface language",
  "settings.uiLanguage.zh": "中文",
  "settings.uiLanguage.en": "English",
  "settings.tts": "Text-to-speech",
  "settings.tts.hint": "Pick the engine, voice, language, and speed. Changes take effect on the next playback.",
  "settings.tts.engine": "Engine",
  "settings.tts.language": "Language",
  "settings.tts.voice": "Voice",
  "settings.tts.speed": "Speed",
  "settings.tts.preload": "Pre-warm on launch",
  "settings.tts.preload.on": "Preload silently on app boot (recommended)",
  "settings.tts.preload.off": "Load on first ▶ Play",
  "settings.storage": "Storage",
  "settings.storage.importsBackup": "Import backup directory",
  "settings.storage.importsBackup.pick": "Pick a folder…",
  "settings.storage.importsBackup.disabled": "(unset — no extra copy)",
  "settings.storage.importsBackup.clear": "Clear",
  "settings.reading": "Reading",
  "settings.reading.fontSize": "Font size preset",
  "settings.reading.fontSize.small": "Small",
  "settings.reading.fontSize.medium": "Medium",
  "settings.reading.fontSize.large": "Large",
  "settings.reading.fontSizePx": "Custom font size (px)",
  "settings.reading.fontSizePx.usePreset": "use preset above",
  "settings.reading.theme": "Theme",
  "settings.reading.brightness": "Brightness",
  "settings.reading.pageTurnMode": "Page-turn gesture",
  "settings.reading.pageTurnMode.tap": "Tap regions",
  "settings.reading.pageTurnMode.swipe": "Swipe horizontally",
  "settings.reading.menuAutoHide": "Auto-hide menu",
  "settings.reading.menuAutoHide.on": "Hide after 2 s",
  "settings.reading.menuAutoHide.off": "Tap outside to hide",
  "settings.about": "About",
  "settings.about.kokoroNote": "Kokoro supports 9 languages (including Mandarin). Windows users who don't want to set up CUDA can pick Kokoro instead of Qwen.",

  "theme.white": "White",
  "theme.warm-paper": "Warm paper",
  "theme.sepia": "Sepia",
  "theme.eye-protect-green": "Eye-protect green",
  "theme.gray": "Gray",
  "theme.low-contrast": "Low contrast",
  "theme.cool-paper": "Cool paper",
  "theme.rose": "Rose",
  "theme.dark": "Dark",
  "theme.black": "Black",
};

const TABLES: Record<Locale, Messages> = { zh: ZH, en: EN };

export type MessageKey = keyof Messages;

export function translate(locale: Locale | undefined, key: MessageKey): string {
  const table = TABLES[locale ?? "zh"] ?? ZH;
  return table[key];
}

/** Format a message with `{name}` placeholders replaced from `params`. */
export function format(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => {
    const v = params[k];
    return v == null ? `{${k}}` : String(v);
  });
}

import { useSettingsStore } from "../state/settings";

/** React hook: returns a `t(key)` bound to the current UI language. */
export function useT(): (key: MessageKey) => string {
  const lang = useSettingsStore((s) => s.settings.uiLanguage) as Locale;
  return (key) => translate(lang, key);
}
