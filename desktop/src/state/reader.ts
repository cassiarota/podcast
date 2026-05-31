import { create } from "zustand";
import { api, type Page, type Section } from "../lib/api";

interface ReaderState {
  openBookId: string | null;
  sections: Section[];
  currentPage: Page | null;
  pageIndex: number;
  pageCount: number;
  controlsVisible: boolean;
  tocOpen: boolean;
  open: (bookId: string) => Promise<void>;
  close: () => void;
  goTo: (pageIndex: number) => Promise<void>;
  next: () => Promise<void>;
  prev: () => Promise<void>;
  toggleControls: () => void;
  hideControls: () => void;
  showControls: () => void;
  setTocOpen: (v: boolean) => void;
}

export const useReaderStore = create<ReaderState>((set, get) => ({
  openBookId: null,
  sections: [],
  currentPage: null,
  pageIndex: 0,
  pageCount: 0,
  controlsVisible: false,
  tocOpen: false,
  open: async (bookId: string) => {
    const { book, sections } = await api.openBook(bookId);
    const pos = await api.getReadingPosition(bookId);
    const startIndex = pos?.page_index ?? 0;
    const page = await api.getPage(bookId, startIndex);
    set({
      openBookId: bookId,
      sections,
      currentPage: page,
      pageIndex: startIndex,
      pageCount: book.page_count,
      controlsVisible: false,
      tocOpen: false,
    });
  },
  close: () => set({ openBookId: null, currentPage: null, sections: [] }),
  goTo: async (pageIndex: number) => {
    const { openBookId, pageCount } = get();
    if (!openBookId) return;
    const clamped = Math.max(0, Math.min(pageIndex, pageCount - 1));
    const page = await api.getPage(openBookId, clamped);
    if (!page) return;
    const percent = pageCount > 0 ? (clamped + 1) / pageCount : 0;
    await api.saveReadingPosition(
      openBookId,
      page.section_id,
      clamped,
      page.source_offset,
      percent
    );
    set({ currentPage: page, pageIndex: clamped });
  },
  next: async () => {
    const { pageIndex } = get();
    await get().goTo(pageIndex + 1);
  },
  prev: async () => {
    const { pageIndex } = get();
    await get().goTo(pageIndex - 1);
  },
  toggleControls: () =>
    set((s) => ({ controlsVisible: !s.controlsVisible })),
  hideControls: () => set({ controlsVisible: false }),
  showControls: () => set({ controlsVisible: true }),
  setTocOpen: (v: boolean) => set({ tocOpen: v }),
}));
