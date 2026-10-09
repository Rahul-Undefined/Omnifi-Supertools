"use client";
import { useEffect } from "react";
import { openPalette } from "./CommandPalette";

/** Global keyboard shortcuts. Documented on /help. */
export function Shortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        openPalette();
      } else if (mod && e.key === "/") {
        e.preventDefault();
        const el = document.querySelector<HTMLInputElement>("[data-global-search]");
        if (el) el.focus();
        else openPalette();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return null;
}
