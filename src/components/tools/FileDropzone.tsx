"use client";
import { useCallback, useRef, useState } from "react";
import { UploadCloud, FileIcon, X, AlertCircle } from "lucide-react";
import { cn, formatBytes } from "@/lib/utils";
import { validateFile } from "@/lib/files";
import { site } from "@/config/site";
import { Button } from "@/components/ui/Button";

export interface QueuedFile {
  id: string;
  file: File;
  error?: string;
}

interface Props {
  accept: string[];
  multiple?: boolean;
  fileCount?: number;
  files: QueuedFile[];
  onChange: (files: QueuedFile[]) => void;
  maxBytes?: number;
  disabled?: boolean;
  hint?: string;
}

function acceptAttr(accept: string[]): string | undefined {
  if (!accept.length || accept.includes("*")) return undefined;
  return accept.map((a) => (a.includes("/") ? a : `.${a.replace(/^\./, "")}`)).join(",");
}

function acceptLabel(accept: string[]): string {
  if (!accept.length || accept.includes("*")) return "Any file";
  const parts = accept.map((a) => (a.endsWith("/*") ? a.replace("/*", "") : a.includes("/") ? a.split("/")[1].toUpperCase() : a.toUpperCase()));
  return [...new Set(parts)].join(", ");
}

export function FileDropzone({ accept, multiple, fileCount, files, onChange, maxBytes = site.limits.browserFileBytes, disabled, hint }: Props) {
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const add = useCallback(
    async (incoming: FileList | File[]) => {
      const list = Array.from(incoming);
      const validated: QueuedFile[] = [];
      for (const f of list) {
        const v = await validateFile(f, accept, maxBytes);
        validated.push({ id: `${f.name}-${f.size}-${f.lastModified}-${Math.random().toString(36).slice(2, 7)}`, file: f, error: v.ok ? undefined : v.reason });
      }
      let next = multiple || fileCount ? [...files, ...validated] : validated.slice(0, 1);
      if (fileCount) next = next.slice(0, fileCount);
      if (next.length > site.limits.batchFiles) next = next.slice(0, site.limits.batchFiles);
      onChange(next);
    },
    [accept, files, multiple, fileCount, maxBytes, onChange],
  );

  const remove = (id: string) => onChange(files.filter((f) => f.id !== id));
  const canAddMore = (multiple && files.length < site.limits.batchFiles) || (fileCount ? files.length < fileCount : files.length === 0);

  return (
    <div className="space-y-3">
      {canAddMore && (
        <div
          role="button"
          tabIndex={0}
          aria-label="Drop files here or browse"
          onClick={() => !disabled && inputRef.current?.click()}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); inputRef.current?.click(); } }}
          onDragOver={(e) => { e.preventDefault(); if (!disabled) setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); if (!disabled && e.dataTransfer.files.length) void add(e.dataTransfer.files); }}
          className={cn(
            "relative flex cursor-pointer flex-col items-center justify-center rounded-control border-2 border-dashed px-6 py-12 text-center transition-[border-color,background-color,transform] duration-300 ease-brand",
            drag ? "border-accent bg-accent-soft scale-[1.01]" : "border-border-strong bg-surface-2/60 hover:border-accent hover:bg-accent-soft/60",
            disabled && "pointer-events-none opacity-60",
          )}
        >
          <span className={cn("mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-accent-soft text-accent transition-transform duration-300", drag && "scale-110")}>
            <UploadCloud className="h-7 w-7" />
          </span>
          <p className="text-base font-semibold text-foreground">Drop {multiple ? "your files" : "your file"} here</p>
          <p className="mt-1 text-sm text-muted">
            or <span className="font-medium text-accent">browse</span> · {acceptLabel(accept)} · up to {formatBytes(maxBytes, 0)} each
            {fileCount ? ` · exactly ${fileCount} files` : ""}
          </p>
          {hint && <p className="mt-2 text-xs text-muted">{hint}</p>}
          <input ref={inputRef} type="file" className="sr-only" accept={acceptAttr(accept)} multiple={Boolean(multiple || (fileCount && fileCount > 1))} onChange={(e) => { if (e.target.files?.length) void add(e.target.files); e.target.value = ""; }} />
        </div>
      )}
      {files.length > 0 && (
        <ul className="divide-y divide-border rounded-control border border-border bg-surface">
          {files.map((f, i) => (
            <li key={f.id} className="flex items-center gap-3 px-4 py-2.5 text-sm animate-fade-up">
              <span className="w-5 shrink-0 text-xs text-muted tabular-nums">{i + 1}</span>
              <FileIcon className="h-4 w-4 shrink-0 text-muted" />
              <span className="min-w-0 flex-1 truncate text-foreground">{f.file.name}</span>
              <span className="shrink-0 text-xs text-muted tabular-nums">{formatBytes(f.file.size)}</span>
              {f.error && <span className="flex items-center gap-1 text-xs text-error"><AlertCircle className="h-3.5 w-3.5" /> {f.error}</span>}
              {!disabled && (
                <button type="button" onClick={() => remove(f.id)} className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-error" aria-label={`Remove ${f.file.name}`}>
                  <X className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
          {!disabled && files.length > 1 && (
            <li className="flex justify-end px-3 py-2">
              <Button variant="ghost" size="sm" onClick={() => onChange([])}>Clear all</Button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
