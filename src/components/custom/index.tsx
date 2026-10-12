"use client";
import dynamic from "next/dynamic";
import type { ComponentType } from "react";

/** Registry of interactive tool pages, keyed by the tool's processor id. */
const components: Record<string, ComponentType> = {
  "custom.typing": dynamic(() => import("./TypingTest").then((m) => m.TypingTest), { ssr: false, loading: () => <div className="h-64 animate-pulse rounded-control bg-surface-2" /> }),
  "custom.organize": dynamic(() => import("./PageOrganizer").then((m) => m.PageOrganizer), { ssr: false, loading: () => <div className="h-64 animate-pulse rounded-control bg-surface-2" /> }),
  "custom.redact": dynamic(() => import("./PdfRedactor").then((m) => m.PdfRedactor), { ssr: false, loading: () => <div className="h-64 animate-pulse rounded-control bg-surface-2" /> }),
  "custom.invoice": dynamic(() => import("./InvoiceGenerator").then((m) => m.InvoiceGenerator), { ssr: false, loading: () => <div className="h-64 animate-pulse rounded-control bg-surface-2" /> }),
  "custom.tts": dynamic(() => import("./SpeechTools").then((m) => m.TextToSpeech), { ssr: false, loading: () => <div className="h-64 animate-pulse rounded-control bg-surface-2" /> }),
  "custom.dictation": dynamic(() => import("./SpeechTools").then((m) => m.Dictation), { ssr: false, loading: () => <div className="h-64 animate-pulse rounded-control bg-surface-2" /> }),
  "custom.fillForm": dynamic(() => import("./PdfFormFiller").then((m) => m.PdfFormFiller), { ssr: false, loading: () => <div className="h-64 animate-pulse rounded-control bg-surface-2" /> }),
  "custom.videoDownloader": dynamic(() => import("./VideoDownloader").then((m) => m.VideoDownloader), { ssr: false, loading: () => <div className="h-64 animate-pulse rounded-control bg-surface-2" /> }),
  "custom.stepsRecorder": dynamic(() => import("./StepsRecorderDownload").then((m) => m.StepsRecorderDownload), { ssr: false, loading: () => <div className="h-64 animate-pulse rounded-control bg-surface-2" /> }),
};

export function CustomTool({ processor }: { processor: string }) {
  const C = components[processor];
  if (!C) return <p className="text-sm text-muted">This interactive tool has no component registered.</p>;
  return <C />;
}
