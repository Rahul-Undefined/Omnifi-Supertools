"use client";
import { useEffect } from "react";
import { usePrefs, applyTheme } from "@/store/prefs";

export function ThemeInit() {
  const theme = usePrefs((s) => s.theme);
  useEffect(() => {
    applyTheme(theme);
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme(usePrefs.getState().theme);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);
  return null;
}
