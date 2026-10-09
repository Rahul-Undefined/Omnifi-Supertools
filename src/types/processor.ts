import type { OptionValues } from "./tool";

export interface ProcessorFile {
  name: string;
  blob: Blob;
  bytes: number;
  mime?: string;
}

export interface ProcessorContext {
  options: OptionValues;
  /** Report 0..1 progress. */
  onProgress?: (fraction: number, label?: string) => void;
  signal?: AbortSignal;
}

export interface ProcessorOutput {
  files: ProcessorFile[];
  /** Human readable stats such as { Original: "24.5 MB", Output: "7.2 MB", Saved: "70.6%" } */
  stats?: Record<string, string>;
  /** Text output for text/calculator tools. */
  text?: string;
  /** Optional structured result for rich rendering. */
  data?: unknown;
  /** Optional warnings surfaced to the user (never silently ignored). */
  warnings?: string[];
}

export type FileProcessor = (files: File[], ctx: ProcessorContext) => Promise<ProcessorOutput>;
export type TextProcessor = (input: string, ctx: ProcessorContext) => Promise<ProcessorOutput>;
export type CalcProcessor = (ctx: ProcessorContext) => Promise<ProcessorOutput>;

export type AnyProcessor = FileProcessor | TextProcessor | CalcProcessor;

export class ProcessorError extends Error {
  hint?: string;
  constructor(message: string, hint?: string) {
    super(message);
    this.name = "ProcessorError";
    this.hint = hint;
  }
}

export function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new ProcessorError("Cancelled");
}
