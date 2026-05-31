import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import { api, type Section, type Book } from "./../lib/api";

export interface PendingChapter {
  id: string;
  title: string;
  ord: number;
  /** Whether this chapter should be included in the generation batch. */
  checked: boolean;
}

export interface PendingJob {
  /** Local id (uuid-ish) — not the backend job id. */
  id: string;
  bookId: string;
  title: string;
  chapters: PendingChapter[];
  /** Lazy-loaded once the user expands the row. */
  chaptersLoaded: boolean;
}

export interface ActiveJob {
  /** Backend job id. */
  id: string;
  bookId: string;
  title: string;
  scope: string;
  progress: number; // 0..1
  status: "running" | "done" | "failed";
  startedAt: number;
}

interface JobsState {
  /** Panel UI open / closed. */
  open: boolean;
  pending: PendingJob[];
  active: ActiveJob[];
  done: ActiveJob[];
  setOpen: (v: boolean) => void;
  togglePanel: () => void;

  enqueueBooks: (books: Book[]) => Promise<void>;
  loadChapters: (pendingId: string) => Promise<void>;
  toggleChapter: (pendingId: string, sectionId: string, value?: boolean) => void;
  setAllChapters: (pendingId: string, value: boolean) => void;
  removePending: (pendingId: string) => void;

  /** Kick off jobs for `pendingId` based on its currently checked chapters. */
  startPending: (pendingId: string) => Promise<void>;
  startAllPending: () => Promise<void>;

  /** Internal — called by the tts:* event listeners. */
  recordProgress: (jobId: string, bookId: string, progress: number) => void;
  recordDone: (jobId: string, bookId: string, status: string) => void;
}

let unlistenProgress: (() => void) | null = null;
let unlistenDone: (() => void) | null = null;

async function installListeners(get: () => JobsState) {
  if (unlistenProgress) return;
  unlistenProgress = await listen<{ job_id: string; book_id: string; progress: number }>(
    "tts:progress",
    (e) => {
      const { job_id, book_id, progress } = e.payload;
      get().recordProgress(job_id, book_id, progress);
    }
  );
  unlistenDone = await listen<{ job_id: string; book_id: string; status: string }>(
    "tts:done",
    (e) => {
      const { job_id, book_id, status } = e.payload;
      get().recordDone(job_id, book_id, status);
    }
  );
}

function titleOrFallback(s: Section): string {
  return s.title?.trim() ? s.title : `Section ${s.ord + 1}`;
}

let pendingSeq = 1;
function nextPendingId(): string {
  return `p-${Date.now().toString(36)}-${pendingSeq++}`;
}

export const useJobsStore = create<JobsState>((set, get) => {
  // Wire up the Tauri event listeners once.
  void installListeners(get);

  return {
    open: false,
    pending: [],
    active: [],
    done: [],
    setOpen: (v) => set({ open: v }),
    togglePanel: () => set((s) => ({ open: !s.open })),

    enqueueBooks: async (books) => {
      const next: PendingJob[] = books.map((b) => ({
        id: nextPendingId(),
        bookId: b.id,
        title: b.title,
        chapters: [],
        chaptersLoaded: false,
      }));
      set((s) => ({ pending: [...s.pending, ...next], open: true }));
      // Background-load chapters for each so the panel can show them immediately.
      for (const p of next) {
        void get().loadChapters(p.id);
      }
    },

    loadChapters: async (pendingId) => {
      const p = get().pending.find((x) => x.id === pendingId);
      if (!p || p.chaptersLoaded) return;
      try {
        const { sections } = await api.openBook(p.bookId);
        const chapters: PendingChapter[] = sections.map((s) => ({
          id: s.id,
          title: titleOrFallback(s),
          ord: s.ord,
          checked: true,
        }));
        set((s) => ({
          pending: s.pending.map((x) =>
            x.id === pendingId ? { ...x, chapters, chaptersLoaded: true } : x
          ),
        }));
      } catch (e) {
        console.error("[jobs] loadChapters failed", e);
      }
    },

    toggleChapter: (pendingId, sectionId, value) => {
      set((s) => ({
        pending: s.pending.map((p) => {
          if (p.id !== pendingId) return p;
          return {
            ...p,
            chapters: p.chapters.map((c) =>
              c.id === sectionId
                ? { ...c, checked: value == null ? !c.checked : value }
                : c
            ),
          };
        }),
      }));
    },

    setAllChapters: (pendingId, value) => {
      set((s) => ({
        pending: s.pending.map((p) =>
          p.id === pendingId
            ? { ...p, chapters: p.chapters.map((c) => ({ ...c, checked: value })) }
            : p
        ),
      }));
    },

    removePending: (pendingId) =>
      set((s) => ({ pending: s.pending.filter((p) => p.id !== pendingId) })),

    startPending: async (pendingId) => {
      const p = get().pending.find((x) => x.id === pendingId);
      if (!p) return;
      const checked = p.chapters.filter((c) => c.checked);
      // Defensive: if chapters haven't loaded or all unchecked, treat as
      // "whole book" intent so users aren't blocked by network races.
      const scopes: string[] =
        checked.length === 0 || checked.length === p.chapters.length
          ? ["whole_book"]
          : checked.map((c) => `section:${c.id}`);

      // Fire each scope as its own job; track them in `active`.
      for (const scope of scopes) {
        try {
          const job = await api.startTtsJob(p.bookId, scope, "");
          set((s) => ({
            active: [
              ...s.active,
              {
                id: job.id,
                bookId: p.bookId,
                title: p.title + (scope === "whole_book" ? "" : ` · ${scopeLabel(scope, p)}`),
                scope,
                progress: 0,
                status: "running",
                startedAt: Date.now(),
              },
            ],
          }));
        } catch (e) {
          console.error("[jobs] startTtsJob failed", scope, e);
        }
      }
      get().removePending(pendingId);
    },

    startAllPending: async () => {
      const ids = get().pending.map((p) => p.id);
      for (const id of ids) await get().startPending(id);
    },

    recordProgress: (jobId, bookId, progress) => {
      set((s) => {
        // If we don't know about this job (server-side restart, race),
        // synthesize a row so the user still sees something.
        const exists = s.active.find((a) => a.id === jobId);
        if (!exists) {
          return {
            active: [
              ...s.active,
              {
                id: jobId,
                bookId,
                title: bookId.slice(0, 6),
                scope: "unknown",
                progress,
                status: "running",
                startedAt: Date.now(),
              },
            ],
          };
        }
        return {
          active: s.active.map((a) =>
            a.id === jobId ? { ...a, progress, status: "running" } : a
          ),
        };
      });
    },

    recordDone: (jobId, _bookId, status) => {
      set((s) => {
        const job = s.active.find((a) => a.id === jobId);
        if (!job) return s;
        const finished: ActiveJob = {
          ...job,
          progress: 1,
          status: status === "completed" ? "done" : "failed",
        };
        return {
          active: s.active.filter((a) => a.id !== jobId),
          done: [finished, ...s.done].slice(0, 20),
        };
      });
    },
  };
});

function scopeLabel(scope: string, p: PendingJob): string {
  if (scope.startsWith("section:")) {
    const id = scope.slice("section:".length);
    const ch = p.chapters.find((c) => c.id === id);
    return ch?.title ?? scope;
  }
  return scope;
}
