import { invoke } from "@tauri-apps/api/core";

export interface Book {
  id: string;
  title: string;
  author: string | null;
  source_format: "txt" | "epub";
  page_count: number;
  created_at: number;
}

export interface Section {
  id: string;
  book_id: string;
  title: string;
  ord: number;
}

export interface Page {
  id: string;
  book_id: string;
  section_id: string;
  page_index: number;
  content: string;
  source_offset: number;
  source_len: number;
}

export interface ReadingPosition {
  book_id: string;
  section_id: string;
  page_index: number;
  source_offset: number;
  percent: number;
}

export interface ReaderSettings {
  fontSize: "small" | "medium" | "large";
  /** Custom px override. 0 means "use the preset above". */
  fontSizePx: number;
  background: string;
  brightness: number;
  /** App chrome language: "zh" or "en". */
  uiLanguage: "zh" | "en";
  /** "tap" (current default) or "swipe" (horizontal drag gesture). */
  pageTurnMode: "tap" | "swipe";
  /** When true the bottom controls auto-hide after 2 s of inactivity. */
  menuAutoHide: boolean;
}

export interface TtsSettings {
  engine: string;
  voice: string;
  language: string;
  speed: number;
  /** Pre-warm the engine in the background on app boot. */
  preload: boolean;
  /** Optional directory where a plain-text copy of each import is dropped. */
  importsBackupDir: string | null;
}

export interface LanguageInfo {
  code: string;
  label: string;
}

export interface VoiceInfo {
  id: string;
  label: string;
  language: string;
}

export interface EngineInfo {
  id: string;
  label: string;
  description: string;
  languages: LanguageInfo[];
  voices: VoiceInfo[];
}

export interface TtsJob {
  id: string;
  book_id: string;
  scope: string;
  status: "queued" | "loading" | "generating" | "cancelled" | "failed" | "completed";
  progress: number;
  engine: string;
  voice_preset: string;
  error?: string | null;
}

export interface AudioChunk {
  id: string;
  page_id: string;
  cache_key: string;
  path: string;
  duration_ms: number;
}

export interface TtsStatus {
  sidecar_running: boolean;
  engine_loaded: boolean;
  engine: string | null;
  idle_seconds: number | null;
}

export const api = {
  importBook: (path: string, generateAudio = false): Promise<Book> =>
    invoke("import_book", { path, generateAudio }),
  listBooks: (): Promise<Book[]> => invoke("list_books"),
  deleteBook: (bookId: string): Promise<void> => invoke("delete_book", { bookId }),
  openBook: (bookId: string): Promise<{ book: Book; sections: Section[] }> =>
    invoke("open_book", { bookId }),
  getPage: (bookId: string, pageIndex: number): Promise<Page | null> =>
    invoke("get_page", { bookId, pageIndex }),
  firstPageOfSection: (bookId: string, sectionId: string): Promise<number> =>
    invoke("first_page_of_section", { bookId, sectionId }),
  getReadingPosition: (bookId: string): Promise<ReadingPosition | null> =>
    invoke("get_reading_position", { bookId }),
  saveReadingPosition: (
    bookId: string,
    sectionId: string,
    pageIndex: number,
    sourceOffset: number,
    percent: number
  ): Promise<void> =>
    invoke("save_reading_position", {
      bookId,
      sectionId,
      pageIndex,
      sourceOffset,
      percent,
    }),
  getReaderSettings: (): Promise<ReaderSettings> =>
    invoke("get_reader_settings"),
  saveReaderSettings: (settings: ReaderSettings): Promise<void> =>
    invoke("save_reader_settings", { settings }),

  getTtsSettings: (): Promise<TtsSettings> => invoke("get_tts_settings"),
  saveTtsSettings: (settings: TtsSettings): Promise<void> =>
    invoke("save_tts_settings", { settings }),
  listEngines: (): Promise<EngineInfo[]> => invoke("list_engines"),

  // M3+ TTS
  startTtsJob: (
    bookId: string,
    scope: string,
    voicePreset: string
  ): Promise<TtsJob> =>
    invoke("start_tts_job", { bookId, scope, voicePreset }),
  cancelTtsJob: (jobId: string): Promise<void> =>
    invoke("cancel_tts_job", { jobId }),
  playCachedOrGenerate: (
    bookId: string,
    pageId: string,
    voicePreset: string
  ): Promise<AudioChunk> =>
    invoke("play_cached_or_generate", { bookId, pageId, voicePreset }),
  getTtsStatus: (): Promise<TtsStatus> => invoke("get_tts_status"),
};
