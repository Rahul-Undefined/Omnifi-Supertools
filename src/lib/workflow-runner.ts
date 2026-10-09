import type { WorkflowStep } from "@/store/workflows";
import type { ProcessorFile, ProcessorOutput, FileProcessor } from "@/types/processor";
import { ProcessorError } from "@/types/processor";
import { getTool } from "@/tools/registry";
import { resolveProcessor } from "@/processors";

export interface StepResult {
  stepId: string;
  toolId: string;
  status: "done" | "failed" | "skipped";
  output?: ProcessorOutput;
  error?: string;
  ms: number;
}

function toFiles(outs: ProcessorFile[]): File[] {
  return outs.map((f) => new File([f.blob], f.name, { type: f.mime ?? f.blob.type }));
}

/** Unzip intermediate archives so the next step sees the individual files. */
async function explodeZips(files: File[]): Promise<File[]> {
  const out: File[] = [];
  for (const f of files) {
    if (f.name.toLowerCase().endsWith(".zip") && f.type === "application/zip") {
      const JSZip = (await import("jszip")).default;
      const z = await JSZip.loadAsync(await f.arrayBuffer());
      for (const e of Object.values(z.files)) {
        if (e.dir || e.name.includes("..")) continue;
        const blob = await e.async("blob");
        out.push(new File([blob], e.name.split("/").pop()!, { type: blob.type }));
      }
    } else out.push(f);
  }
  return out;
}

/**
 * Run steps in order, feeding each step's output files into the next.
 * Every step must be a chainable, browser-side file tool.
 */
export async function runWorkflow(
  steps: WorkflowStep[],
  inputFiles: File[],
  onProgress: (stepIndex: number, fraction: number, label?: string) => void,
  signal?: AbortSignal,
): Promise<{ results: StepResult[]; files: ProcessorFile[] }> {
  let current = inputFiles;
  const results: StepResult[] = [];
  let lastOutput: ProcessorFile[] = [];
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const tool = getTool(step.toolId);
    const started = performance.now();
    if (!tool || tool.status !== "ready" || tool.kind !== "file") {
      results.push({ stepId: step.id, toolId: step.toolId, status: "skipped", error: "Tool unavailable", ms: 0 });
      continue;
    }
    if (signal?.aborted) throw new ProcessorError("Cancelled");
    try {
      const fn = (await resolveProcessor(tool.processor)) as FileProcessor;
      const ctx = { options: step.options, signal, onProgress: (f: number, l?: string) => onProgress(i, f, l) };
      let output: ProcessorOutput;
      if (tool.combine || tool.fileCount) {
        output = await fn(current, ctx);
      } else {
        // Per-file tools: run each file and merge.
        const parts: ProcessorOutput[] = [];
        for (let k = 0; k < current.length; k++) {
          if (signal?.aborted) throw new ProcessorError("Cancelled");
          parts.push(await fn([current[k]], { ...ctx, onProgress: (f, l) => onProgress(i, (k + f) / current.length, l) }));
        }
        output = { files: parts.flatMap((p) => p.files), text: parts.map((p) => p.text).filter(Boolean).join("\n\n") || undefined, warnings: parts.flatMap((p) => p.warnings ?? []) };
      }
      results.push({ stepId: step.id, toolId: step.toolId, status: "done", output, ms: Math.round(performance.now() - started) });
      lastOutput = output.files;
      current = await explodeZips(toFiles(output.files));
      if (!current.length && i < steps.length - 1) throw new ProcessorError(`${tool.name} produced no files for the next step`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed";
      results.push({ stepId: step.id, toolId: step.toolId, status: "failed", error: msg, ms: Math.round(performance.now() - started) });
      throw e;
    }
  }
  return { results, files: lastOutput };
}
