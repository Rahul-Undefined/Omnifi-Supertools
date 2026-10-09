"use client";
import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { FileDropzone, type QueuedFile } from "@/components/tools/FileDropzone";
import { ResultPanel } from "@/components/tools/ResultPanel";
import { ProgressBar } from "@/components/tools/ProgressBar";
import type { ProcessorOutput } from "@/types/processor";

/** Shared frame for interactive PDF pages: dropzone -> editor -> result. */
export function PdfToolShell({ hint, children, output, onReset, progress }: { hint?: string; children: (file: File, done: (o: ProcessorOutput) => void) => React.ReactNode; output: ProcessorOutput | null; onReset: () => void; progress?: { value: number; label?: string } | null }) {
  const [files, setFiles] = useState<QueuedFile[]>([]);
  const file = files.find((f) => !f.error)?.file ?? null;
  return (
    <div className="space-y-5">
      <p className="flex items-start gap-2.5 rounded-control border border-border bg-surface-2 px-4 py-3 text-sm text-body"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" /><span>Runs entirely in your browser. Your file never leaves this computer.</span></p>
      {output ? (
        <ResultPanel output={output} onReset={() => { setFiles([]); onReset(); }} />
      ) : !file ? (
        <FileDropzone accept={["pdf"]} files={files} onChange={setFiles} hint={hint} />
      ) : (
        <>
          {progress && <ProgressBar value={progress.value} label={progress.label ?? "Working…"} />}
          {children(file, () => {})}
        </>
      )}
    </div>
  );
}

export function useOutput() {
  const [output, setOutput] = useState<ProcessorOutput | null>(null);
  const [progress, setProgress] = useState<{ value: number; label?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  return { output, setOutput, progress, setProgress, error, setError, reset: () => { setOutput(null); setProgress(null); setError(null); } };
}
