"use client";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Theme = "light" | "dark" | "system";

interface Prefs {
  theme: Theme;
  favorites: string[];
  recent: { id: string; at: number }[];
  usage: Record<string, number>;
  setTheme: (t: Theme) => void;
  toggleFavorite: (id: string) => void;
  isFavorite: (id: string) => boolean;
  touchRecent: (id: string) => void;
  recordUse: (id: string) => void;
}

export const usePrefs = create<Prefs>()(
  persist(
    (set, get) => ({
      theme: "system",
      favorites: [],
      recent: [],
      usage: {},
      setTheme: (theme) => set({ theme }),
      toggleFavorite: (id) =>
        set((s) => ({
          favorites: s.favorites.includes(id) ? s.favorites.filter((f) => f !== id) : [id, ...s.favorites],
        })),
      isFavorite: (id) => get().favorites.includes(id),
      touchRecent: (id) =>
        set((s) => ({
          recent: [{ id, at: Date.now() }, ...s.recent.filter((r) => r.id !== id)].slice(0, 30),
        })),
      recordUse: (id) => set((s) => ({ usage: { ...s.usage, [id]: (s.usage[id] ?? 0) + 1 } })),
    }),
    { name: "omnifi-supertools-prefs" },
  ),
);

export function applyTheme(theme: Theme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const dark = theme === "dark" || (theme === "system" && systemDark);
  root.classList.toggle("dark", dark);
  root.dataset.theme = dark ? "dark" : "light";
}
