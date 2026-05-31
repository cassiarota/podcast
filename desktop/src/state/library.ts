import { create } from "zustand";
import { api, type Book } from "../lib/api";

interface LibraryState {
  books: Book[];
  loading: boolean;
  /** Multi-select mode toggled from the shelf header. */
  selectMode: boolean;
  selectedIds: Set<string>;
  refresh: () => Promise<void>;
  importBook: (path: string, generateAudio?: boolean) => Promise<void>;
  deleteBook: (id: string) => Promise<void>;
  deleteBooks: (ids: string[]) => Promise<void>;
  setSelectMode: (v: boolean) => void;
  toggleSelected: (id: string) => void;
  clearSelected: () => void;
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  books: [],
  loading: false,
  selectMode: false,
  selectedIds: new Set(),
  refresh: async () => {
    set({ loading: true });
    try {
      const books = await api.listBooks();
      set({ books, loading: false });
    } catch (e) {
      console.error("listBooks failed", e);
      set({ loading: false });
    }
  },
  importBook: async (path: string, generateAudio = false) => {
    await api.importBook(path, generateAudio);
    await get().refresh();
  },
  deleteBook: async (id: string) => {
    await api.deleteBook(id);
    await get().refresh();
    const next = new Set(get().selectedIds);
    next.delete(id);
    set({ selectedIds: next });
  },
  deleteBooks: async (ids: string[]) => {
    for (const id of ids) {
      try { await api.deleteBook(id); } catch (e) { console.error("delete", id, e); }
    }
    await get().refresh();
    set({ selectedIds: new Set(), selectMode: false });
  },
  setSelectMode: (v: boolean) => {
    if (!v) set({ selectMode: false, selectedIds: new Set() });
    else set({ selectMode: true });
  },
  toggleSelected: (id: string) => {
    const next = new Set(get().selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    set({ selectedIds: next });
  },
  clearSelected: () => set({ selectedIds: new Set() }),
}));
