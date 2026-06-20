import { create } from "zustand";
import { convertFileSrc } from "@tauri-apps/api/core";
import { api, type AudioChunk } from "../lib/api";
import { splitSentences } from "../lib/sentences";

export type PlayerStatus = "idle" | "loading" | "playing" | "paused";

export interface SentenceSlot {
  text: string;
  chunk: AudioChunk | null;
  loading: boolean;
  error?: string;
}

interface PlayerState {
  status: PlayerStatus;
  bookId: string | null;
  pageId: string | null;
  /** All sentences on the currently-playing page. */
  sentences: SentenceSlot[];
  /** Which sentence is currently playing (or about to). */
  currentSentence: number;
  durationMs: number;
  positionMs: number;
  error: string | null;
  /** Linear playback rate applied via audio.playbackRate. */
  playbackRate: number;
  setPlaybackRate: (r: number) => void;

  /**
   * Streaming page playback. Splits `text` into sentences, fires all
   * synth requests in parallel, plays in order starting at `fromIndex`.
   */
  playPage: (
    bookId: string,
    pageId: string,
    text: string,
    fromIndex?: number,
  ) => Promise<void>;

  /** Single-sentence playback (legacy fallback). */
  play: (bookId: string, pageId: string) => Promise<void>;

  pause: () => void;
  resume: () => void;
  stop: () => void;
  /** Jump to the given sentence index within the current page and resume. */
  seekToSentence: (index: number) => Promise<void>;
  clearError: () => void;
}

let audio: HTMLAudioElement | null = null;
// Active "playing" session id from the stats backend.
let playingSessionId: string | null = null;
let playingForBook: string | null = null;
// Cancellation token — bumped on stop() to interrupt the sentence loop.
let playGeneration = 0;

async function ensurePlayingSession(bookId: string) {
  if (playingSessionId && playingForBook === bookId) return;
  if (playingSessionId) {
    api.endSession(playingSessionId).catch(() => {});
    playingSessionId = null;
  }
  try {
    playingSessionId = await api.startSession("playing", bookId);
    playingForBook = bookId;
  } catch (e) {
    console.warn("[stats] startSession playing failed", e);
  }
}

function closePlayingSession() {
  if (!playingSessionId) return;
  const id = playingSessionId;
  playingSessionId = null;
  playingForBook = null;
  api.endSession(id).catch(() => {});
}

function ensureAudio(set: (p: Partial<PlayerState>) => void): HTMLAudioElement {
  if (audio) return audio;
  const a = new Audio();
  a.preload = "auto";
  a.volume = 1.0;
  // preservesPitch: TS doesn't have this on HTMLMediaElement yet.
  (a as any).preservesPitch = true;
  a.addEventListener("play", () => set({ status: "playing" }));
  a.addEventListener("pause", () => {
    if (a.ended) set({ status: "idle", positionMs: 0 });
    else set({ status: "paused", positionMs: Math.round(a.currentTime * 1000) });
  });
  a.addEventListener("error", () => {
    closePlayingSession();
    const code = a.error?.code;
    const msg = a.error?.message || `audio error code=${code}`;
    set({ status: "idle", error: msg });
    console.error("[player] audio error", code, msg, "src=", a.src);
  });
  a.addEventListener("timeupdate", () => {
    set({ positionMs: Math.round(a.currentTime * 1000) });
  });
  a.addEventListener("durationchange", () => {
    if (a.duration && Number.isFinite(a.duration)) {
      set({ durationMs: Math.round(a.duration * 1000) });
    }
  });
  audio = a;
  return a;
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  status: "idle",
  bookId: null,
  pageId: null,
  sentences: [],
  currentSentence: 0,
  durationMs: 0,
  positionMs: 0,
  error: null,
  playbackRate: 1.0,
  setPlaybackRate: (r) => {
    set({ playbackRate: r });
    if (audio) audio.playbackRate = r;
  },

  playPage: async (bookId, pageId, text, fromIndex = 0) => {
    const a = ensureAudio(set);
    const sentences = splitSentences(text);
    if (sentences.length === 0) return;

    const myGeneration = ++playGeneration;
    set({
      status: "loading",
      bookId,
      pageId,
      error: null,
      sentences: sentences.map((t) => ({ text: t, chunk: null, loading: true })),
      currentSentence: fromIndex,
      positionMs: 0,
      durationMs: 0,
    });
    void ensurePlayingSession(bookId);

    // Kick off all synth requests in parallel. Each request's promise
    // gets stored so the play-loop can await them in order.
    const promises: Promise<AudioChunk>[] = sentences.map((t) =>
      api.synthSentence(t, bookId),
    );

    // Mark slots as their requests resolve, for the highlighting UI to
    // show ✓ progress on pre-cached sentences.
    promises.forEach((p, idx) => {
      p.then((chunk) => {
        if (playGeneration !== myGeneration) return;
        set((s) => ({
          sentences: s.sentences.map((slot, i) =>
            i === idx ? { ...slot, chunk, loading: false } : slot,
          ),
        }));
      }).catch((e) => {
        if (playGeneration !== myGeneration) return;
        const msg = String(e);
        console.error("[player] synth failed for sentence", idx, msg);
        set((s) => ({
          sentences: s.sentences.map((slot, i) =>
            i === idx ? { ...slot, loading: false, error: msg } : slot,
          ),
        }));
      });
    });

    // Sequentially play.
    for (let i = fromIndex; i < sentences.length; i++) {
      if (playGeneration !== myGeneration) return; // stopped/replaced
      set({ currentSentence: i });
      void api.savePlaybackPosition(bookId, pageId, i).catch((e) =>
        console.warn("[player] save playback position failed", e),
      );
      let chunk: AudioChunk;
      try {
        chunk = await promises[i];
      } catch (e) {
        set({ status: "idle", error: String(e) });
        return;
      }
      if (playGeneration !== myGeneration) return;
      a.src = convertFileSrc(chunk.path);
      a.playbackRate = get().playbackRate;
      a.currentTime = 0;
      try {
        await a.play();
      } catch (e) {
        set({ status: "idle", error: `audio.play(): ${e}` });
        return;
      }
      // Wait for ended OR cancellation.
      await new Promise<void>((resolve) => {
        const onEnded = () => {
          a.removeEventListener("ended", onEnded);
          resolve();
        };
        const onStopped = setInterval(() => {
          if (playGeneration !== myGeneration) {
            a.removeEventListener("ended", onEnded);
            clearInterval(onStopped);
            resolve();
          }
        }, 200);
        a.addEventListener("ended", onEnded, { once: true });
      });
    }

    if (playGeneration !== myGeneration) return;
    closePlayingSession();
    set({ status: "idle", positionMs: 0 });

    // Auto-advance to next page if the user has it on.
    try {
      const { useSettingsStore } = await import("./settings");
      const settings = useSettingsStore.getState().settings;
      if (!settings.autoPageTurn) return;
      const { useReaderStore } = await import("./reader");
      const reader = useReaderStore.getState();
      if (!reader.openBookId || reader.pageIndex >= reader.pageCount - 1) return;
      await reader.next();
      const next = useReaderStore.getState().currentPage;
      const bid = useReaderStore.getState().openBookId;
      if (next && bid) {
        await usePlayerStore.getState().playPage(bid, next.id, next.content);
      }
    } catch (e) {
      console.warn("[player] auto-advance failed", e);
    }
  },

  play: async (bookId: string, pageId: string) => {
    // Fetch the page text and delegate to playPage.
    try {
      const { useReaderStore } = await import("./reader");
      const reader = useReaderStore.getState();
      const text = reader.currentPage?.content;
      if (!text) {
        set({ status: "idle", error: "no page text" });
        return;
      }
      const saved = await api.getPlaybackPosition(bookId);
      const fromIndex = saved?.page_id === pageId ? saved.sentence_index : 0;
      await get().playPage(bookId, pageId, text, fromIndex);
    } catch (e) {
      set({ status: "idle", error: String(e) });
    }
  },

  pause: () => {
    if (!audio) return;
    audio.pause();
  },
  resume: () => {
    if (!audio) return;
    audio.play().catch((e) => set({ status: "idle", error: String(e) }));
  },
  stop: () => {
    playGeneration++; // cancel any active playPage loop
    closePlayingSession();
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
      audio.removeAttribute("src");
      audio.load();
    }
    set({
      status: "idle",
      bookId: null,
      pageId: null,
      sentences: [],
      currentSentence: 0,
      positionMs: 0,
      durationMs: 0,
    });
  },
  seekToSentence: async (index) => {
    const s = get();
    if (!s.bookId || !s.pageId || s.sentences.length === 0) return;
    const text = s.sentences.map((x) => x.text).join("\n\n");
    await get().playPage(s.bookId, s.pageId, text, Math.max(0, Math.min(index, s.sentences.length - 1)));
  },
  clearError: () => set({ error: null }),
}));
