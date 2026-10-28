"use client";
import { useMemo, useRef, useState } from "react";
import { Play, Square, Download, RotateCcw, ListFilter } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Card";
import { tools, categories } from "@/tools/registry";
import { customProcessors } from "@/components/custom";
import { runChecks, toCsv, type CheckResult, type CheckStatus, type CheckOptions } from "@/lib/checker/run";

const TONE: Record<CheckStatus, "success" | "warning" | "error" | "neutral" | "accent"> = { pass: "success", warn: "warning", fail: "error", skipped: "neutral", manual: "accent" };
const LABEL: Record<CheckStatus, string> = { pass: "Working", warn: "Working, with notes", fail: "Not working", skipped: "Skipped", manual: "Manual check" };

/**
 * Admin-only tool checker. Generates random input for every registered tool,
 * runs the real processor in this browser tab, analyses the result and moves
 * on to the next one. Nothing is uploaded; the report stays on this page until
 * exported.
 */
export function ToolChecker() {
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1_000_000));
  const [includeServer, setIncludeServer] = useState(false);
  const [includeAi, setIncludeAi] = useState(false);
  const [includeMedia, setIncludeMedia] = useState(true);
  const [includeOcr, setIncludeOcr] = useState(true);
  const [category, setCategory] = useState("all");
  const [results, setResults] = useState<CheckResult[]>([]);
  const [running, setRunning] = useState(false);
  const [current, setCurrent] = useState<string | null>(null);
  const [filter, setFilter] = useState<CheckStatus | "all">("all");
  const abortRef = useRef<AbortController | null>(null);

  const queue = useMemo(() => tools.filter((t) => category === "all" || t.category === category), [category]);

  async function start(only?: Set<string>) {
    if (running) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    if (!only) setResults([]);
    const opts: CheckOptions = { seed, includeServer, includeAi, includeMedia, includeOcr, only };
    try {
      for await (const r of runChecks(queue, opts, customProcessors, controller.signal)) {
        setCurrent(r.id);
        setResults((prev) => (only ? prev.map((p) => (p.id === r.id ? r : p)) : [...prev, r]));
      }
    } finally {
      setRunning(false);
      setCurrent(null);
      abortRef.current = null;
    }
  }

  function stop() { abortRef.current?.abort(); }

  const counts = useMemo(() => {
    const c: Record<CheckStatus, number> = { pass: 0, warn: 0, fail: 0, skipped: 0, manual: 0 };
    for (const r of results) c[r.status]++;
    return c;
  }, [results]);
  const shown = results.filter((r) => filter === "all" || r.status === filter);
  const totalMs = results.reduce((s, r) => s + r.ms, 0);

  function exportFile(kind: "json" | "csv") {
    const body = kind === "json" ? JSON.stringify({ seed, at: new Date().toISOString(), options: { includeServer, includeAi, includeMedia, includeOcr, category }, results }, null, 2) : toCsv(results);
    const blob = new Blob([body], { type: kind === "json" ? "application/json" : "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `supertools-check-${new Date().toISOString().slice(0, 10)}-seed${seed}.${kind}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  return (
    <div className="space-y-6">
      <div className="rounded-control border border-border bg-surface p-5">
        <div className="flex flex-wrap items-end gap-4">
          <label className="text-sm">
            <span className="block text-xs font-medium uppercase tracking-wide text-muted">Category</span>
            <select value={category} onChange={(e) => setCategory(e.target.value)} disabled={running} className="mt-1 h-10 rounded-control border border-border bg-surface px-3 text-sm text-foreground">
              <option value="all">All categories ({tools.length} tools)</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name} ({tools.filter((t) => t.category === c.id).length})</option>)}
            </select>
          </label>
          <label className="text-sm">
            <span className="block text-xs font-medium uppercase tracking-wide text-muted">Random seed</span>
            <div className="mt-1 flex items-center gap-1">
              <input type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value) || 1)} disabled={running} className="h-10 w-32 rounded-control border border-border bg-surface px-3 text-sm text-foreground" />
              <Button variant="ghost" size="sm" type="button" onClick={() => setSeed(Math.floor(Math.random() * 1_000_000))} disabled={running} aria-label="New seed"><RotateCcw className="h-4 w-4" /></Button>
            </div>
          </label>
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-body">
            <label className="flex items-center gap-2"><input type="checkbox" checked={includeMedia} onChange={(e) => setIncludeMedia(e.target.checked)} disabled={running} /> Include media tools (FFmpeg)</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={includeOcr} onChange={(e) => setIncludeOcr(e.target.checked)} disabled={running} /> Include OCR</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={includeServer} onChange={(e) => setIncludeServer(e.target.checked)} disabled={running} /> Include server tools (network)</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={includeAi} onChange={(e) => setIncludeAi(e.target.checked)} disabled={running} /> Include AI tools (uses your AI allowance)</label>
          </div>
          <div className="ml-auto flex gap-2">
            {running ? <Button variant="secondary" type="button" onClick={stop}><Square className="h-4 w-4" /> Stop</Button> : <Button type="button" onClick={() => start()}><Play className="h-4 w-4" /> Run checker</Button>}
            {results.length > 0 && !running && counts.fail + counts.warn > 0 && <Button variant="secondary" type="button" onClick={() => start(new Set(results.filter((r) => r.status === "fail" || r.status === "warn").map((r) => r.id)))}>Re-run failed</Button>}
          </div>
        </div>
        <p className="mt-3 text-xs text-muted">Each tool gets freshly generated random input (PDFs, images, spreadsheets, Word and PowerPoint files, audio, video, text) built in this browser. The checker runs the real processor, inspects the output (file headers, page counts, replaced text, decoded values) and writes a comment. Change the seed for different data. Nothing is uploaded or recorded.</p>
      </div>

      {(results.length > 0 || running) && (
        <div className="rounded-control border border-border bg-surface p-5">
          <div className="flex flex-wrap items-center gap-3">
            {(["pass", "warn", "fail", "manual", "skipped"] as CheckStatus[]).map((s) => (
              <button key={s} type="button" onClick={() => setFilter(filter === s ? "all" : s)} className={`rounded-full border px-3 py-1 text-sm ${filter === s ? "border-accent bg-accent-soft text-accent" : "border-border bg-surface-2 text-body hover:bg-surface"}`}>
                <Badge tone={TONE[s]} className="mr-1.5">{counts[s]}</Badge>{LABEL[s]}
              </button>
            ))}
            <span className="text-sm text-muted">{results.length} / {queue.length} checked · {(totalMs / 1000).toFixed(0)} s</span>
            {running && <span className="flex items-center gap-2 text-sm text-accent"><span className="h-2 w-2 animate-pulse rounded-full bg-accent" /> Checking {current ?? "…"}</span>}
            <div className="ml-auto flex gap-2">
              <Button variant="ghost" size="sm" type="button" onClick={() => exportFile("csv")} disabled={!results.length}><Download className="h-4 w-4" /> CSV</Button>
              <Button variant="ghost" size="sm" type="button" onClick={() => exportFile("json")} disabled={!results.length}><Download className="h-4 w-4" /> JSON</Button>
            </div>
          </div>
          {running && <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-2"><div className="h-full bg-accent transition-all" style={{ width: `${(results.length / Math.max(1, queue.length)) * 100}%` }} /></div>}
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-muted">
                <tr><th className="py-2 pr-3">Tool</th><th className="py-2 pr-3">Result</th><th className="py-2 pr-3">Time</th><th className="py-2 pr-3">Input</th><th className="py-2 pr-3">Output</th><th className="py-2">Comment</th></tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.id} className="border-t border-border align-top">
                    <td className="py-2 pr-3 whitespace-nowrap"><a href={`/tools/${r.id}`} target="_blank" rel="noreferrer" className="font-medium text-foreground hover:text-accent">{r.name}</a><div className="text-xs text-muted">{r.category} · {r.kind}{r.runtime === "server" ? " · server" : ""}</div></td>
                    <td className="py-2 pr-3 whitespace-nowrap"><Badge tone={TONE[r.status]}>{LABEL[r.status]}</Badge></td>
                    <td className="py-2 pr-3 whitespace-nowrap text-muted">{r.ms ? `${(r.ms / 1000).toFixed(1)} s` : "–"}</td>
                    <td className="py-2 pr-3 max-w-[16rem] text-xs text-muted break-words">{r.input}</td>
                    <td className="py-2 pr-3 max-w-[16rem] text-xs text-muted break-words">{r.output}</td>
                    <td className="py-2 max-w-[28rem] text-xs text-body break-words">{r.comment}</td>
                  </tr>
                ))}
                {!shown.length && <tr><td colSpan={6} className="py-6 text-center text-muted"><ListFilter className="mx-auto mb-1 h-4 w-4" />Nothing in this filter yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
