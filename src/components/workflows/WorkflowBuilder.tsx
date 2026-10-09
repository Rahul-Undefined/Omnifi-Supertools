"use client";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Plus, Trash2, ArrowUp, ArrowDown, Copy, Star, Play, Square, Settings2, ChevronDown, Workflow as WorkflowIcon, Check } from "lucide-react";
import { useWorkflows, newStepId, type Workflow, type WorkflowStep } from "@/store/workflows";
import { tools, getTool, toolsAccepting, accepts } from "@/tools/registry";
import { Button } from "@/components/ui/Button";
import { Input, Label, Select } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Card";
import { OptionsForm, defaultOptions } from "@/components/tools/OptionsForm";
import { FileDropzone, type QueuedFile } from "@/components/tools/FileDropzone";
import { ProgressBar } from "@/components/tools/ProgressBar";
import { ResultPanel } from "@/components/tools/ResultPanel";
import { ToolIcon } from "@/components/tools/ToolIcon";
import { EmptyState } from "@/components/layout/EmptyState";
import { runWorkflow, type StepResult } from "@/lib/workflow-runner";
import type { ProcessorOutput } from "@/types/processor";
import { cn } from "@/lib/utils";

const chainable = tools.filter((t) => t.status === "ready" && t.chainable && t.kind === "file" && t.runtime === "browser");

const TEMPLATES: { name: string; steps: string[] }[] = [
  { name: "Scanned PDF → clean Excel", steps: ["ocr-pdf"] },
  { name: "PDF tables → Excel", steps: ["extract-pdf-tables", "csv-to-excel"] },
  { name: "Images → web ready ZIP", steps: ["resize-image", "compress-image", "convert-image", "zip-creator"] },
  { name: "Photos → one compressed PDF", steps: ["compress-image", "jpg-to-pdf", "compress-pdf"] },
  { name: "Bank CSV → cleaned workbook", steps: ["transaction-cleaner", "duplicate-transactions"] },
];

export function WorkflowBuilder() {
  const params = useSearchParams();
  const router = useRouter();
  const { workflows, activeId, setActive, create, update, remove, duplicate } = useWorkflows();
  // Persisted stores hydrate after mount; render nothing on the server pass to avoid a mismatch.
  const hydrated = useSyncExternalStore(() => () => {}, () => true, () => false);
  const selectedId = activeId && workflows.some((w) => w.id === activeId) ? activeId : (workflows[0]?.id ?? null);
  const selected = workflows.find((w) => w.id === selectedId) ?? null;
  const setSelectedId = setActive;

  // /workflows?add=tool-id creates a new workflow starting with that tool (store update, then clear the param).
  useEffect(() => {
    const add = params.get("add");
    if (!add || !hydrated) return;
    const t = getTool(add);
    if (t) create(`${t.name} workflow`, [{ id: newStepId(), toolId: t.id, options: defaultOptions(t.options) }]);
    router.replace("/workflows");
  }, [params, hydrated, create, router]);

  if (!hydrated) return null;

  return (
    <div className="grid gap-8 lg:grid-cols-[280px_minmax(0,1fr)]">
      <aside className="space-y-4">
        <Button className="w-full" onClick={() => setSelectedId(create().id)}><Plus className="h-4 w-4" /> New workflow</Button>
        <div className="rounded-control border border-border bg-surface p-2">
          {workflows.length === 0 && <p className="px-3 py-6 text-center text-sm text-muted">No workflows yet.</p>}
          {[...workflows].sort((a, b) => Number(b.favorite) - Number(a.favorite) || b.updatedAt - a.updatedAt).map((w) => (
            <button key={w.id} type="button" onClick={() => setSelectedId(w.id)} className={cn("flex w-full items-center gap-2 rounded-control-sm px-3 py-2.5 text-left text-sm", w.id === selectedId ? "bg-accent-soft text-foreground" : "text-body hover:bg-surface-2")}>
              {w.favorite ? <Star className="h-3.5 w-3.5 shrink-0 text-accent" fill="currentColor" /> : <WorkflowIcon className="h-3.5 w-3.5 shrink-0 text-muted" />}
              <span className="min-w-0 flex-1 truncate">{w.name}</span>
              <span className="text-xs text-muted">{w.steps.length}</span>
            </button>
          ))}
        </div>
        <div>
          <h3 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-muted">Templates</h3>
          <div className="space-y-1">
            {TEMPLATES.map((t) => (
              <button key={t.name} type="button" onClick={() => setSelectedId(create(t.name, t.steps.map((id) => ({ id: newStepId(), toolId: id, options: defaultOptions(getTool(id)?.options) }))).id)} className="flex w-full items-center gap-2 rounded-control-sm px-3 py-2 text-left text-sm text-body hover:bg-surface-2">
                <Plus className="h-3.5 w-3.5 text-muted" /> {t.name}
              </button>
            ))}
          </div>
        </div>
      </aside>
      <div>
        {selected ? (
          <Editor key={selected.id} wf={selected} onChange={(p) => update(selected.id, p)} onDelete={() => { remove(selected.id); setSelectedId(null); }} onDuplicate={() => { const c = duplicate(selected.id); if (c) setSelectedId(c.id); }} />
        ) : (
          <EmptyState icon={<WorkflowIcon className="h-6 w-6" />} title="Build your first workflow" description="Chain tools like OCR → Extract tables → CSV to Excel. Pick a template on the left or start from scratch." />
        )}
      </div>
    </div>
  );
}

function Editor({ wf, onChange, onDelete, onDuplicate }: { wf: Workflow; onChange: (p: Partial<Workflow>) => void; onDelete: () => void; onDuplicate: () => void }) {
  const [files, setFiles] = useState<QueuedFile[]>([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ step: number; f: number; label?: string }>({ step: 0, f: 0 });
  const [results, setResults] = useState<StepResult[]>([]);
  const [output, setOutput] = useState<ProcessorOutput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [openStep, setOpenStep] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const firstTool = getTool(wf.steps[0]?.toolId ?? "");
  const accept = firstTool?.input ?? ["*"];
  const validFiles = useMemo(() => files.filter((f) => !f.error).map((f) => f.file), [files]);

  const setSteps = (steps: WorkflowStep[]) => onChange({ steps });
  const addStep = (toolId: string) => {
    const t = getTool(toolId);
    if (!t) return;
    setSteps([...wf.steps, { id: newStepId(), toolId, options: defaultOptions(t.options) }]);
  };
  const move = (i: number, dir: -1 | 1) => {
    const next = [...wf.steps];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    setSteps(next);
  };

  // Suggest next tools based on the last step's outputs.
  const lastTool = getTool(wf.steps[wf.steps.length - 1]?.toolId ?? "");
  const suggestions = lastTool ? [...new Set(lastTool.output.flatMap((o) => toolsAccepting(o)))] : chainable;

  const run = async () => {
    if (!validFiles.length || !wf.steps.length) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setError(null);
    setOutput(null);
    setResults([]);
    try {
      const r = await runWorkflow(wf.steps, validFiles, (step, f, label) => setProgress({ step, f, label }), controller.signal);
      setResults(r.results);
      setOutput({ files: r.files, stats: { Steps: String(r.results.length), Output: `${r.files.length} file${r.files.length === 1 ? "" : "s"}` }, warnings: r.results.flatMap((x) => x.output?.warnings ?? []) });
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Workflow failed");
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  };

  const flash = () => { setSaved(true); setTimeout(() => setSaved(false), 1200); };

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-3">
        <Input value={wf.name} onChange={(e) => onChange({ name: e.target.value })} onBlur={flash} className="max-w-sm text-base font-semibold" aria-label="Workflow name" />
        <Button variant={wf.favorite ? "primary" : "secondary"} size="sm" onClick={() => onChange({ favorite: !wf.favorite })}><Star className="h-4 w-4" fill={wf.favorite ? "currentColor" : "none"} /> {wf.favorite ? "Favorited" : "Favorite"}</Button>
        <Button variant="secondary" size="sm" onClick={onDuplicate}><Copy className="h-4 w-4" /> Duplicate</Button>
        <Button variant="ghost" size="sm" onClick={() => { if (confirm(`Delete “${wf.name}”?`)) onDelete(); }}><Trash2 className="h-4 w-4" /> Delete</Button>
        <span className={cn("ml-auto flex items-center gap-1 text-xs text-muted transition-opacity", saved ? "opacity-100" : "opacity-0")}><Check className="h-3.5 w-3.5 text-success" /> Saved</span>
      </div>

      <section>
        <h3 className="mb-3 text-sm font-semibold text-foreground">Steps</h3>
        <ol className="space-y-2">
          {wf.steps.length === 0 && <li className="rounded-control border border-dashed border-border-strong px-4 py-6 text-center text-sm text-muted">Add the first step below.</li>}
          {wf.steps.map((s, i) => {
            const t = getTool(s.toolId);
            const res = results.find((r) => r.stepId === s.id);
            const prev = getTool(wf.steps[i - 1]?.toolId ?? "");
            const compatible = !prev || !t || prev.output.some((o) => accepts(t, o) || (o === "zip" && prev.output.length > 1));
            return (
              <li key={s.id} className={cn("rounded-control border bg-surface", res?.status === "failed" ? "border-error/50" : res?.status === "done" ? "border-success/50" : "border-border")}>
                <div className="flex items-center gap-3 px-4 py-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-soft font-mono text-xs text-accent">{i + 1}</span>
                  <ToolIcon name={t?.icon} className="h-4 w-4 text-muted" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">{t?.name ?? s.toolId}</span>
                    <span className="block truncate text-xs text-muted">{t ? `${t.input.map((x) => x.replace("/*", "")).join(", ")} → ${t.output.join(", ")}` : "Unknown tool"}</span>
                  </span>
                  {!compatible && <Badge tone="warning">Input may not match previous output</Badge>}
                  {res?.status === "done" && <Badge tone="success">{res.output?.files.length ?? 0} files · {res.ms} ms</Badge>}
                  {res?.status === "failed" && <Badge tone="error">{res.error}</Badge>}
                  {running && progress.step === i && <span className="w-24"><ProgressBar value={progress.f} label="" /></span>}
                  {t?.options?.length ? (
                    <button type="button" onClick={() => setOpenStep(openStep === s.id ? null : s.id)} className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-accent" aria-label="Configure step" aria-expanded={openStep === s.id}>
                      <Settings2 className="h-4 w-4" />
                    </button>
                  ) : null}
                  <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="rounded-md p-1.5 text-muted hover:bg-surface-2 disabled:opacity-30" aria-label="Move up"><ArrowUp className="h-4 w-4" /></button>
                  <button type="button" onClick={() => move(i, 1)} disabled={i === wf.steps.length - 1} className="rounded-md p-1.5 text-muted hover:bg-surface-2 disabled:opacity-30" aria-label="Move down"><ArrowDown className="h-4 w-4" /></button>
                  <button type="button" onClick={() => setSteps(wf.steps.filter((x) => x.id !== s.id))} className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-error" aria-label="Remove step"><Trash2 className="h-4 w-4" /></button>
                </div>
                {openStep === s.id && t?.options && (
                  <div className="border-t border-border px-4 py-4 animate-fade-up">
                    <OptionsForm fields={t.options} values={s.options} onChange={(v) => setSteps(wf.steps.map((x) => (x.id === s.id ? { ...x, options: v } : x)))} />
                  </div>
                )}
              </li>
            );
          })}
        </ol>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Label htmlFor="add-step" className="mb-0 mr-1">Add step</Label>
          <div className="relative">
            <Select id="add-step" value="" onChange={(e) => { if (e.target.value) addStep(e.target.value); }} className="w-72">
              <option value="">Choose a tool…</option>
              {suggestions.length > 0 && suggestions.length < chainable.length && (
                <optgroup label="Suggested (accepts previous output)">
                  {suggestions.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </optgroup>
              )}
              <optgroup label="All chainable tools">
                {chainable.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </optgroup>
            </Select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 hidden h-4 w-4 -translate-y-1/2 text-muted" />
          </div>
        </div>
      </section>

      <section>
        <h3 className="mb-3 text-sm font-semibold text-foreground">Run</h3>
        {!output && (
          <div className={cn("space-y-4", running && "pointer-events-none opacity-70")}>
            <FileDropzone accept={accept} multiple files={files} onChange={setFiles} disabled={running} hint={firstTool ? `Step 1 (${firstTool.name}) accepts ${accept.map((a) => a.replace("/*", "")).join(", ")}` : undefined} />
            <div className="flex items-center gap-3">
              {running ? (
                <Button variant="secondary" onClick={() => abortRef.current?.abort()}><Square className="h-4 w-4" /> Cancel</Button>
              ) : (
                <Button size="lg" onClick={run} disabled={!validFiles.length || !wf.steps.length}><Play className="h-4 w-4" /> Run workflow</Button>
              )}
              {running && <span className="text-sm text-muted">Step {progress.step + 1} of {wf.steps.length}{progress.label ? ` · ${progress.label}` : ""}</span>}
            </div>
            {running && <ProgressBar value={(progress.step + progress.f) / Math.max(1, wf.steps.length)} label={`${getTool(wf.steps[progress.step]?.toolId ?? "")?.name ?? "Running"}`} />}
            {error && <p className="rounded-control border border-error/40 bg-error-soft px-4 py-3 text-sm text-foreground">{error}</p>}
          </div>
        )}
        {output && <ResultPanel output={output} onReset={() => { setOutput(null); setResults([]); setFiles([]); }} title="Workflow complete" />}
      </section>
    </div>
  );
}
