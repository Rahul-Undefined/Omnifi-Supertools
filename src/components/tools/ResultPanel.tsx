"use client";
import { useMemo, useState } from "react";
import { Check, Copy, Download, RotateCcw, AlertTriangle, Package } from "lucide-react";
import type { ProcessorFile, ProcessorOutput } from "@/types/processor";
import { Button } from "@/components/ui/Button";
import { downloadBlob } from "@/lib/files";
import { formatBytes } from "@/lib/utils";
import { zipFiles } from "@/processors/shared/zip";

interface Props {
  output: ProcessorOutput;
  onReset: () => void;
  title?: string;
  htmlPreview?: boolean;
}

export function ResultPanel({ output, onReset, title = "Done", htmlPreview }: Props) {
  const [copied, setCopied] = useState(false);
  const [zipping, setZipping] = useState(false);
  const previews = useMemo(() => output.files.filter((f) => f.mime?.startsWith("image/") && f.bytes < 15 * 1024 * 1024).slice(0, 6), [output.files]);
  const tableData = output.data as { header?: string[]; rows?: (string | number)[][] } | undefined;
  const isTable = tableData && Array.isArray(tableData.header) && Array.isArray(tableData.rows);

  const copy = async () => {
    if (!output.text) return;
    await navigator.clipboard.writeText(output.text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const downloadAll = async () => {
    setZipping(true);
    try {
      const zip = await zipFiles(output.files, "omnifi-supertools-output.zip");
      downloadBlob(zip.blob, zip.name);
    } finally {
      setZipping(false);
    }
  };

  return (
    <div className="rounded-control border border-success/40 bg-success-soft/40 p-5 sm:p-6 animate-fade-up">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-success text-navy-800"><Check className="h-5 w-5" strokeWidth={3} /></span>
          <div>
            <h2 className="text-lg font-semibold text-foreground">{title}</h2>
            {output.files.length > 0 && <p className="text-sm text-muted">{output.files.length} file{output.files.length === 1 ? "" : "s"} ready</p>}
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={onReset}><RotateCcw className="h-4 w-4" /> Start over</Button>
      </div>

      {output.stats && Object.keys(output.stats).length > 0 && (
        <dl className="mt-5 grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-4">
          {Object.entries(output.stats).map(([k, v]) => (
            <div key={k} className="rounded-control-sm bg-surface/70 px-3.5 py-2.5">
              <dt className="text-xs font-medium uppercase tracking-wide text-muted">{k}</dt>
              <dd className="mt-0.5 font-mono text-sm text-accent break-all">{v}</dd>
            </div>
          ))}
        </dl>
      )}

      {output.warnings?.map((w) => (
        <p key={w} className="mt-4 flex items-start gap-2 rounded-control-sm bg-warning-soft px-3.5 py-2.5 text-sm text-foreground"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" /> {w}</p>
      ))}

      {previews.length > 0 && (
        <div className="mt-5 grid grid-cols-3 gap-2 sm:grid-cols-6">
          {previews.map((f) => <Preview key={f.name} file={f} />)}
        </div>
      )}

      {output.files.length > 0 && (
        <ul className="mt-5 divide-y divide-border rounded-control border border-border bg-surface">
          {output.files.slice(0, 50).map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              <span className="min-w-0 flex-1 truncate text-foreground">{f.name}</span>
              <span className="text-xs text-muted tabular-nums">{formatBytes(f.bytes)}</span>
              <Button size="sm" variant="secondary" onClick={() => downloadBlob(f.blob, f.name)}><Download className="h-4 w-4" /> Download</Button>
            </li>
          ))}
          {output.files.length > 50 && <li className="px-4 py-2 text-xs text-muted">and {output.files.length - 50} more, use Download all.</li>}
        </ul>
      )}

      {output.text !== undefined && output.text !== "" && (
        <div className="mt-5">
          {isTable ? (
            <div className="max-h-96 overflow-auto rounded-control border border-border bg-surface scrollbar-thin">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-navy-800 text-white"><tr>{tableData!.header!.map((h) => <th key={h} className="px-3 py-2 text-left font-semibold">{h}</th>)}</tr></thead>
                <tbody>{tableData!.rows!.slice(0, 500).map((r, i) => <tr key={i} className="odd:bg-surface even:bg-surface-2">{r.map((c, j) => <td key={j} className="px-3 py-1.5 font-mono text-xs text-body tabular-nums">{typeof c === "number" ? c.toLocaleString("en-US", { maximumFractionDigits: 2 }) : c}</td>)}</tr>)}</tbody>
              </table>
            </div>
          ) : htmlPreview ? (
            <div className="prose-omnifi max-h-[32rem] overflow-auto rounded-control border border-border bg-surface p-5 scrollbar-thin" dangerouslySetInnerHTML={{ __html: sanitize(output.text) }} />
          ) : (
            <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap break-words rounded-control border border-border bg-surface p-4 font-mono text-[13px] leading-relaxed text-body scrollbar-thin">{output.text}</pre>
          )}
        </div>
      )}

      <div className="mt-5 flex flex-wrap gap-2">
        {output.files.length === 1 && <Button onClick={() => downloadBlob(output.files[0].blob, output.files[0].name)}><Download className="h-4 w-4" /> Download</Button>}
        {output.files.length > 1 && <Button onClick={downloadAll} loading={zipping}><Package className="h-4 w-4" /> Download all (.zip)</Button>}
        {output.text && <Button variant="secondary" onClick={copy}>{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} {copied ? "Copied" : "Copy"}</Button>}
        <Button variant="ghost" onClick={onReset}>Start over</Button>
      </div>
    </div>
  );
}

function Preview({ file }: { file: ProcessorFile }) {
  const url = useMemo(() => URL.createObjectURL(file.blob), [file.blob]);
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt={file.name} className="aspect-square w-full rounded-control-sm border border-border object-cover bg-surface" onLoad={() => setTimeout(() => URL.revokeObjectURL(url), 60_000)} />;
}

/** Strip scripts and inline handlers from rendered HTML previews. */
function sanitize(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    .replace(/ on\w+="[^"]*"/gi, "")
    .replace(/ on\w+='[^']*'/gi, "")
    .replace(/javascript:/gi, "");
}
