import { create } from "zustand";
import { convertFileSrc } from "@tauri-apps/api/core";
import { api, type AudioChunk } from "../lib/api";

export type PlayerStatus = "idle" | "loading" | "playing" | "paused";

interface PlayerState {
  status: PlayerStatus;
  bookId: string | null;
  pageId: string | null;
  durationMs: number;
  positionMs: number;
  error: string | null;
  play: (bookId: string, pageId: string) => Promise<void>;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  clearError: () => void;
}

let audio: HTMLAudioElement | null = null;
let posTimer: number | null = null;

function ensureAudio(set: (p: Partial<PlayerState>) => void): HTMLAudioElement {
  if (audio) return audio;
  const a = new Audio();
  a.preload = "auto";
  a.volume = 1.0;
  a.addEventListener("play", () => set({ status: "playing" }));
  a.addEventListener("pause", () => {
    // Treat the pause that fires at "ended" specially.
    if (a.ended) set({ status: "idle", positionMs: 0 });
    else set({ status: "paused", positionMs: Math.round(a.currentTime * 1000) });
  });
  a.addEventListener("ended", () => set({ status: "idle", positionMs: 0 }));
  a.addEventListener("error", () => {
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
  durationMs: 0,
  positionMs: 0,
  error: null,
  play: async (bookId: string, pageId: string) => {
    const a = ensureAudio(set);
    set({ status: "loading", bookId, pageId, error: null, positionMs: 0, durationMs: 0 });
    let chunk: AudioChunk;
    try {
      chunk = await api.playCachedOrGenerate(bookId, pageId, "");
    } catch (e) {
      console.error("[player] backend playCachedOrGenerate failed", e);
      set({ status: "idle", error: String(e) });
      return;
    }
    console.info("[player] received chunk", chunk);
    const url = convertFileSrc(chunk.path);
    console.info("[player] resolved file URL", url);
    a.src = url;
    a.currentTime = 0;
    try {
      // play() returns a Promise that REJECTS on autoplay-policy or load errors.
      await a.play();
    } catch (e) {
      console.error("[player] audio.play() rejected", e);
      set({ status: "idle", error: `audio.play(): ${e}` });
    }
  },
  pause: () => {
    if (!audio) return;
    audio.pause();
  },
  resume: () => {
    if (!audio) return;
    audio.play().catch((e) => {
      console.error("[player] resume failed", e);
      set({ status: "idle", error: String(e) });
    });
  },
  stop: () => {
    if (!audio) {
      set({ status: "idle", bookId: null, pageId: null, positionMs: 0, durationMs: 0 });
      return;
    }
    audio.pause();
    audio.currentTime = 0;
    audio.removeAttribute("src");
    audio.load();
    set({ status: "idle", bookId: null, pageId: null, positionMs: 0, durationMs: 0 });
  },
  clearError: () => set({ error: null }),
}));

// Stop the position-update timer when nobody is listening, just to be tidy.
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => {
    if (posTimer) window.clearInterval(posTimer);
    if (audio) {
      audio.pause();
      audio.src = "";
    }
  });
}
