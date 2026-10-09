"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Play, Square, RotateCcw, AlertCircle, ShieldCheck, Server, Sparkles } from "lucide-react";
import type { ToolDefinition, OptionValues } from "@/types/tool";
import type { ProcessorOutput, FileProcessor, TextProcessor, CalcProcessor } from "@/types/processor";
import { ProcessorError } from "@/types/processor";
import { resolveProcessor } from "@/processors";
import { usePrefs } from "@/store/prefs";
import { Button } from "@/components/ui/Button";
import { Label, Textarea } from "@/components/ui/Input";
import { Kbd } from "@/components/ui/Card";
import { FileDropzone, type QueuedFile } from "./FileDropzone";
import { OptionsForm, defaultOptions } from "./OptionsForm";
import { ProgressBar } from "./ProgressBar";
import { ResultPanel } from "./ResultPanel";
import { BatchList, type BatchItem } from "./BatchList";
import { site } from "@/config/site";
import { cn } from "@/lib/utils";

type Phase = "idle" | "running" | "done" | "error";

interface Props {
  tool: ToolDefinition;
  /** Pre-filled text (from ?q= or a workflow). */
  initialText?: string;
}

export function ToolRunner({ tool, initialText = "" }: Props) {
  const [files, setFiles] = useState<QueuedFile[]>([]);
  const [text, setText] = useState(initialText);
  const [options, setOptions] = useState<OptionValues>(() => defaultOptions(tool.options));
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState<string | undefined>();
  const [output, setOutput] = useState<ProcessorOutput | null>(null);
  const [error, setError] = useState<{ message: string; hint?: string } | null>(null);
  const [batch, setBatch] = useState<BatchItem[]>([]);
  const [aiStatus, setAiStatus] = useState<{ configured: boolean; provider?: string; hint?: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const touchRecent = usePrefs((s) => s.touchRecent);
  const recordUse = usePrefs((s) => s.recordUse);

  const isAi = tool.processor.startsWith("ai.");
  const validFiles = useMemo(() => files.filter((f) => !f.error), [files]);
  const batchMode = tool.kind === "file" && tool.multiple && !tool.combine && validFiles.length > 1;
  const canRun =
    phase !== "running" &&
    (tool.kind === "file"
      ? validFiles.length > 0 && (!tool.fileCount || validFiles.length === tool.fileCount)
      : tool.kind === "text"
        ? true
        : true);

  useEffect(() => {
    touchRecent(tool.id);
  }, [tool.id, touchRecent]);

  useEffect(() => {
    if (!isAi) return;
    fetch("/api/ai/status").then((r) => r.json()).then(setAiStatus).catch(() => setAiStatus({ configured: false }));
  }, [isAi]);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setPhase("idle");
    setOutput(null);
    setError(null);
    setBatch([]);
    setProgress(0);
    setProgressLabel(undefined);
    setFiles([]);
  }, []);

  const cancel = () => abortRef.current?.abort();

  const runOne = useCallback(
    async (inputFiles: File[], signal: AbortSignal, onProgress: (f: number, l?: string) => void): Promise<ProcessorOutput> => {
      const fn = await resolveProcessor(tool.processor);
      const ctx = { options, onProgress, signal };
      if (tool.kind === "file") return (fn as FileProcessor)(inputFiles, ctx);
      if (tool.kind === "text") return (fn as TextProcessor)(text, ctx);
      return (fn as CalcProcessor)(ctx);
    },
    [tool.processor, tool.kind, options, text],
  );

  const run = useCallback(async () => {
    if (!canRun) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setPhase("running");
    setError(null);
    setOutput(null);
    setProgress(0);
    const started = performance.now();
    let ok = false;
    try {
      if (batchMode) {
        const items: BatchItem[] = validFiles.map((f) => ({ id: f.id, name: f.file.name, status: "queued" as const, progress: 0 }));
        setBatch(items);
        const results = await runBatch(validFiles, items, controller.signal);
        const merged = mergeOutputs(results.filter((r): r is ProcessorOutput => r !== null));
        const failed = items.filter((i) => i.status === "failed").length;
        if (failed === items.length) throw new ProcessorError("Every file failed", "Check the errors above and retry.");
        if (failed) merged.warnings = [...(merged.warnings ?? []), `${failed} of ${items.length} files failed. Use Retry failed to try them again.`];
        setOutput(merged);
      } else {
        const out = await runOne(validFiles.map((f) => f.file), controller.signal, (f, l) => { setProgress(f); setProgressLabel(l); });
        setOutput(out);
      }
      setPhase("done");
      ok = true;
      recordUse(tool.id);
    } catch (e) {
      if (controller.signal.aborted) {
        setPhase("idle");
      } else {
        setPhase("error");
        setError(toError(e));
      }
    } finally {
      abortRef.current = null;
      void fetch("/api/telemetry", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tool: tool.id, ok, ms: Math.round(performance.now() - started), files: validFiles.length, cancelled: controller.signal.aborted }), keepalive: true }).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canRun, batchMode, validFiles, runOne, tool.id, recordUse]);

  async function runBatch(queue: QueuedFile[], items: BatchItem[], signal: AbortSignal, onlyIds?: Set<string>): Promise<(ProcessorOutput | null)[]> {
    const results: (ProcessorOutput | null)[] = new Array(queue.length).fill(null);
    const update = (id: string, patch: Partial<BatchItem>) => setBatch((b) => b.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    let done = 0;
    for (let i = 0; i < queue.length; i++) {
      const q = queue[i];
      if (onlyIds && !onlyIds.has(q.id)) { results[i] = items[i].output ?? null; continue; }
      if (signal.aborted) { update(q.id, { status: "cancelled" }); continue; }
      update(q.id, { status: "running", progress: 0, error: undefined });
      try {
        const out = await runOne([q.file], signal, (f) => update(q.id, { progress: f }));
        results[i] = out;
        items[i] = { ...items[i], status: "done", progress: 1, output: out };
        update(q.id, { status: "done", progress: 1, output: out });
      } catch (e) {
        if (signal.aborted) { update(q.id, { status: "cancelled" }); continue; }
        const err = toError(e);
        items[i] = { ...items[i], status: "failed", error: err.message };
        update(q.id, { status: "failed", error: err.message });
      }
      done++;
      setProgress(done / queue.length);
      setProgressLabel(`${done} / ${queue.length} completed`);
    }
    return results;
  }

  const retryFailed = async () => {
    const failedIds = new Set(batch.filter((b) => b.status === "failed" || b.status === "cancelled").map((b) => b.id));
    if (!failedIds.size) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setPhase("running");
    setError(null);
    const items = batch.map((b) => ({ ...b }));
    try {
      const results = await runBatch(validFiles, items, controller.signal, failedIds);
      const merged = mergeOutputs(results.filter((r): r is ProcessorOutput => r !== null));
      setOutput(merged);
      setPhase("done");
    } catch (e) {
      setPhase("error");
      setError(toError(e));
    } finally {
      abortRef.current = null;
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); void run(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [run]);

  const aiBlocked = isAi && aiStatus && !aiStatus.configured;

  return (
    <div className="space-y-6">
      {tool.runtime === "server" ? (
        <p className="flex items-start gap-2.5 rounded-control border border-border bg-surface-2 px-4 py-3 text-sm text-body">
          <Server className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
          <span>{isAi ? "Your text is sent to the configured AI provider through the Omnifi server. Nothing is stored." : tool.processor === "utilities.currency" ? "Only exchange rates come from the server (refreshed hourly from a public feed). Your amounts never leave this page." : "Your input is sent to the Omnifi server for processing. Uploaded files are temporarily processed and automatically deleted afterwards. Nothing is stored."}</span>
        </p>
      ) : (
        <p className="flex items-start gap-2.5 rounded-control border border-border bg-surface-2 px-4 py-3 text-sm text-body">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" />
          <span>Runs entirely in your browser. Your files never leave this computer.</span>
        </p>
      )}

      {aiBlocked && (
        <div className="rounded-control border border-warning/40 bg-warning-soft px-4 py-3 text-sm text-foreground">
          <p className="flex items-center gap-2 font-medium"><Sparkles className="h-4 w-4 text-warning" /> AI provider is not configured</p>
          <p className="mt-1 text-body">{aiStatus?.hint ?? "Ask an administrator to set AI_PROVIDER and the matching API key in the server environment. See docs/DEPLOYMENT.md."}</p>
        </div>
      )}

      {phase !== "done" && (
        <div className={cn("space-y-6", phase === "running" && "pointer-events-none opacity-70")}>
          {tool.kind === "file" && (
            <FileDropzone accept={tool.input} multiple={tool.multiple} fileCount={tool.fileCount} files={files} onChange={setFiles} maxBytes={tool.runtime === "server" ? site.limits.serverFileBytes : site.limits.browserFileBytes} disabled={phase === "running"} hint={tool.combine && tool.multiple ? "Files are processed in the order shown." : undefined} />
          )}
          {tool.kind === "text" && (
            <div>
              <Label htmlFor="tool-input">{tool.inputLabel ?? "Input"}</Label>
              <Textarea id="tool-input" data-global-search value={text} onChange={(e) => setText(e.target.value)} placeholder={tool.inputPlaceholder ?? "Paste or type here"} className="min-h-[200px]" disabled={phase === "running"} spellCheck={false} />
            </div>
          )}
          {tool.options && tool.options.length > 0 && (
            <div>
              <h3 className="mb-3 text-sm font-semibold text-foreground">Options</h3>
              <OptionsForm fields={tool.options} values={options} onChange={setOptions} disabled={phase === "running"} />
            </div>
          )}
        </div>
      )}

      {phase === "running" && (
        <div className="space-y-4 rounded-control border border-border bg-surface p-5 animate-fade-up">
          <ProgressBar value={progress} label={progressLabel ?? (batchMode ? "Processing" : "Processing…")} indeterminate={!batchMode && progress === 0} />
          {batchMode && <BatchList items={batch} />}
          <div className="flex justify-end">
            <Button variant="secondary" size="sm" onClick={cancel}><Square className="h-3.5 w-3.5" /> Cancel</Button>
          </div>
        </div>
      )}

      {phase === "error" && error && (
        <div className="rounded-control border border-error/40 bg-error-soft px-5 py-4 animate-fade-up">
          <p className="flex items-center gap-2 font-medium text-foreground"><AlertCircle className="h-4 w-4 text-error" /> {error.message}</p>
          {error.hint && <p className="mt-1 text-sm text-body">{error.hint}</p>}
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={run}><RotateCcw className="h-4 w-4" /> Try again</Button>
            <Button size="sm" variant="ghost" onClick={reset}>Start over</Button>
          </div>
        </div>
      )}

      {phase === "done" && output && (
        <>
          {batchMode && batch.some((b) => b.status === "failed" || b.status === "cancelled") && (
            <div className="rounded-control border border-border bg-surface p-4">
              <BatchList items={batch} />
              <div className="mt-3"><Button size="sm" variant="secondary" onClick={retryFailed}><RotateCcw className="h-4 w-4" /> Retry failed</Button></div>
            </div>
          )}
          <ResultPanel output={output} onReset={reset} htmlPreview={tool.output.includes("html")} />
        </>
      )}

      {phase !== "done" && phase !== "running" && (
        <div className="flex flex-wrap items-center gap-3">
          <Button size="lg" onClick={run} disabled={!canRun || Boolean(aiBlocked)}>
            <Play className="h-4 w-4" /> {tool.kind === "file" ? (validFiles.length > 1 ? `Process ${validFiles.length} files` : "Run") : "Run"}
          </Button>
          <span className="hidden sm:flex items-center gap-1 text-xs text-muted"><Kbd>Ctrl</Kbd><Kbd>Enter</Kbd></span>
          {tool.kind === "file" && tool.fileCount && validFiles.length !== tool.fileCount && <span className="text-sm text-muted">Add exactly {tool.fileCount} files.</span>}
        </div>
      )}
    </div>
  );
}

function toError(e: unknown): { message: string; hint?: string } {
  if (e instanceof ProcessorError) return { message: e.message, hint: e.hint };
  if (e instanceof Error) {
    if (/memory|allocation/i.test(e.message)) return { message: "The browser ran out of memory", hint: "Try a smaller file or fewer files at once." };
    return { message: "Something went wrong. Try again.", hint: e.message.slice(0, 200) };
  }
  return { message: "Something went wrong. Try again." };
}

function mergeOutputs(outputs: ProcessorOutput[]): ProcessorOutput {
  const files = outputs.flatMap((o) => o.files);
  const text = outputs.map((o) => o.text).filter(Boolean).join("\n\n");
  const warnings = outputs.flatMap((o) => o.warnings ?? []);
  const original = outputs.reduce((a, o) => a + parseSize(o.stats?.Original), 0);
  const out = outputs.reduce((a, o) => a + parseSize(o.stats?.Output), 0);
  const stats: Record<string, string> = { Files: String(files.length) };
  if (original > 0 && out > 0) {
    stats.Original = fmt(original);
    stats.Output = fmt(out);
    stats.Saved = `${(((original - out) / original) * 100).toFixed(1)}%`;
  }
  return { files, text: text || undefined, warnings: warnings.length ? warnings : undefined, stats, data: outputs.length === 1 ? outputs[0].data : outputs.map((o) => o.data) };
}

function parseSize(s?: string): number {
  if (!s) return 0;
  const m = s.match(/([\d.]+)\s*(B|KB|MB|GB)/i);
  if (!m) return 0;
  const mult = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3 }[m[2].toLowerCase()] ?? 1;
  return parseFloat(m[1]) * mult;
}
function fmt(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}
