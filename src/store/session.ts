"use client";
import { create } from "zustand";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: "admin" | "user";
  firstName?: string;
  via?: "microsoft" | "local" | "header";
}

export interface SessionMeta {
  required: boolean;
  methods: { microsoft: boolean; local: boolean };
}

interface SessionState {
  user: SessionUser | null;
  meta: SessionMeta | null;
  loaded: boolean;
  refresh: () => Promise<void>;
}

let inflight: Promise<void> | null = null;

export const useSession = create<SessionState>()((set) => ({
  user: null,
  meta: null,
  loaded: false,
  refresh: async () => {
    if (!inflight) {
      inflight = fetch("/api/auth/me", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : { user: null }))
        .then((d) => set({ user: d.user ?? null, meta: d.required !== undefined ? { required: d.required, methods: d.methods } : null, loaded: true }))
        .catch(() => set({ user: null, loaded: true }))
        .finally(() => { inflight = null; });
    }
    return inflight;
  },
}));

if (typeof window !== "undefined") {
  queueMicrotask(() => { void useSession.getState().refresh(); });
}
