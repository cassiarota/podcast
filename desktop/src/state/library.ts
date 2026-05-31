import { create } from "zustand";
import { api, type Book } from "../lib/api";

interface LibraryState {
  books: Book[];
  loading: boolean;
  refresh: () => Promise<void>;
  importBook: (path: string, generateAudio?: boolean) => Promise<void>;
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  books: [],
  loading: false,
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
}));
