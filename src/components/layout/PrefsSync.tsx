"use client";
import { useEffect, useRef } from "react";
import { useSession } from "@/store/session";
import { usePrefs } from "@/store/prefs";

type Synced = { favorites: string[]; recent: { id: string; at: number }[] };

const pick = (): Synced => { const s = usePrefs.getState(); return { favorites: s.favorites, recent: s.recent }; };
const same = (a: Synced, b: Synced) => JSON.stringify(a) === JSON.stringify(b);

function merge(server: Synced, local: Synced): Synced {
  const favorites = [...server.favorites, ...local.favorites.filter((f) => !server.favorites.includes(f))];
  const byId = new Map<string, number>();
  for (const r of [...server.recent, ...local.recent]) byId.set(r.id, Math.max(byId.get(r.id) ?? 0, r.at));
  const recent = [...byId.entries()].map(([id, at]) => ({ id, at })).sort((a, b) => b.at - a.at).slice(0, 30);
  return { favorites, recent };
}

/**
 * Keeps favorites and recently-used tools attached to the signed-in person
 * rather than to one browser: pulled from the server on sign-in, merged with
 * what this browser already had, and pushed back (debounced) on every change.
 */
export function PrefsSync() {
  const userId = useSession((s) => s.user?.id);
  const lastPushed = useRef<Synced | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!userId) { lastPushed.current = null; return; }
    let cancelled = false;
    const push = async (data: Synced) => {
      if (lastPushed.current && same(lastPushed.current, data)) return;
      lastPushed.current = data;
      try { await fetch("/api/me/prefs", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(data) }); } catch { /* offline: retried on next change */ }
    };
    (async () => {
      try {
        const res = await fetch("/api/me/prefs", { cache: "no-store" });
        if (cancelled || res.status !== 200) return;
        const body = (await res.json()) as { prefs: Synced | null };
        const local = pick();
        const merged = body.prefs ? merge(body.prefs, local) : local;
        if (!same(merged, local)) usePrefs.setState({ favorites: merged.favorites, recent: merged.recent });
        if (body.prefs && same(body.prefs, merged)) lastPushed.current = merged;
        else await push(merged);
      } catch { /* server unreachable: local copy keeps working */ }
    })();
    const unsub = usePrefs.subscribe((s, prev) => {
      if (s.favorites === prev.favorites && s.recent === prev.recent) return;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void push(pick()), 800);
    });
    return () => { cancelled = true; unsub(); if (timer.current) clearTimeout(timer.current); };
  }, [userId]);

  return null;
}
