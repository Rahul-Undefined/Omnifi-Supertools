"use client";
import { Star } from "lucide-react";
import { useEffect } from "react";
import { usePrefs } from "@/store/prefs";
import { Button } from "@/components/ui/Button";

export function FavoriteButton({ toolId }: { toolId: string }) {
  const isFav = usePrefs((s) => s.favorites.includes(toolId));
  const toggle = usePrefs((s) => s.toggleFavorite);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key.toLowerCase() === "f" && !e.ctrlKey && !e.metaKey && !e.altKey && !(t && ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName)) && !t?.isContentEditable) toggle(toolId);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toolId, toggle]);
  return (
    <Button variant={isFav ? "primary" : "secondary"} size="sm" onClick={() => toggle(toolId)} aria-pressed={isFav}>
      <Star className="h-4 w-4" fill={isFav ? "currentColor" : "none"} /> {isFav ? "Favorited" : "Add to favorites"}
    </Button>
  );
}
