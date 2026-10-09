"use client";
import { create } from "zustand";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: "admin" | "user";
}

interface SessionState {
  user: SessionUser | null;
  loaded: boolean;
  refresh: () => Promise<void>;
}

let inflight: Promise<void> | null = null;

export const useSession = create<SessionState>()((set) => ({
  user: null,
  loaded: false,
  refresh: async () => {
    if (!inflight) {
      inflight = fetch("/api/auth/me", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : { user: null }))
        .then((d) => set({ user: d.user ?? null, loaded: true }))
        .catch(() => set({ user: null, loaded: true }))
        .finally(() => { inflight = null; });
    }
    return inflight;
  },
}));

// Kick off once on the client.
if (typeof window !== "undefined") {
  queueMicrotask(() => { void useSession.getState().refresh(); });
}
