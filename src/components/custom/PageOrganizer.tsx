"use client";
import { useEffect, useState } from "react";
import { RotateCw, RotateCcw, Trash2, ArrowLeft, ArrowRight, Download, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { PdfToolShell, useOutput } from "./PdfToolShell";
import { cn } from "@/lib/utils";

interface Thumb { index: number; url: string; rotation: number; deleted: boolean; w: number; h: number }

export function PageOrganizer() {
  const o = useOutput();
  return (
    <PdfToolShell hint="Drag pages to reorder, rotate or remove them, then download." output={o.output} onReset={o.reset} progress={o.progress}>
      {(file) => <Editor file={file} onDone={o.setOutput} setProgress={o.setProgress} />}
    </PdfToolShell>
  );
}

function Editor({ file, onDone, setProgress }: { file: File; onDone: (o: import("@/types/processor").ProcessorOutput) => void; setProgress: (p: { value: number; label?: string } | null) => void }) {
  const [thumbs, setThumbs] = useState<Thumb[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { openPdf, renderPage, closePdf } = await import("@/processors/shared/pdfjs");
        const { canvasToBlob } = await import("@/processors/shared/canvas");
        const doc = await openPdf(file);
        const list: Thumb[] = [];
        for (let p = 1; p <= doc.numPages; p++) {
          const canvas = await renderPage(doc, p, 0.35);
          const blob = await canvasToBlob(canvas, "image/jpeg", 0.7);
          list.push({ index: p - 1, url: URL.createObjectURL(blob), rotation: 0, deleted: false, w: canvas.width, h: canvas.height });
          if (!cancelled) setThumbs([...list]);
        }
        await closePdf(doc);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not open this PDF");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [file]);

  const move = (from: number, to: number) => {
    if (to < 0 || to >= thumbs.length || from === to) return;
    setThumbs((t) => { const c = [...t]; const [x] = c.splice(from, 1); c.splice(to, 0, x); return c; });
  };
  const update = (i: number, patch: Partial<Thumb>) => setThumbs((t) => t.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  const kept = thumbs.filter((t) => !t.deleted);

  const exportPdf = async () => {
    setBusy(true);
    setProgress({ value: 0.5, label: "Building PDF" });
    try {
      const { applyPageOps } = await import("@/processors/pdf/advanced");
      const out = await applyPageOps(file, kept.map((t) => ({ index: t.index, rotation: t.rotation })));
      onDone({ files: [out], stats: { Pages: String(kept.length), Removed: String(thumbs.length - kept.length) } });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  if (error) return <p className="rounded-control bg-error-soft px-4 py-3 text-sm">{error}</p>;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={exportPdf} loading={busy} disabled={!kept.length || loading}><Download className="h-4 w-4" /> Download {kept.length} page{kept.length === 1 ? "" : "s"}</Button>
        <Button variant="ghost" size="sm" onClick={() => setThumbs((t) => [...t].sort((a, b) => a.index - b.index).map((x) => ({ ...x, rotation: 0, deleted: false })))}><Undo2 className="h-4 w-4" /> Reset</Button>
        <span className="text-xs text-muted">{loading ? `Rendering pages… ${thumbs.length}` : `${thumbs.length} pages · drag to reorder`}</span>
      </div>
      <ol className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {thumbs.map((t, i) => (
          <li
            key={t.index}
            draggable
            onDragStart={() => setDrag(i)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => { if (drag !== null) move(drag, i); setDrag(null); }}
            className={cn("group relative rounded-control border bg-surface p-2 transition-[opacity,border-color]", t.deleted ? "opacity-40 border-dashed" : "border-border hover:border-accent", drag === i && "border-accent")}
          >
            <div className="flex aspect-[3/4] items-center justify-center overflow-hidden rounded-control-sm bg-surface-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={t.url} alt={`Page ${t.index + 1}`} style={{ transform: `rotate(${t.rotation}deg)` }} className="max-h-full max-w-full transition-transform" draggable={false} />
            </div>
            <div className="mt-2 flex items-center justify-between text-xs text-muted">
              <span>#{i + 1} <span className="opacity-60">(was {t.index + 1})</span></span>
              {t.rotation ? <span>{t.rotation}°</span> : null}
            </div>
            <div className="mt-1 flex justify-between gap-1">
              <button type="button" onClick={() => move(i, i - 1)} className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-accent" aria-label="Move left"><ArrowLeft className="h-4 w-4" /></button>
              <button type="button" onClick={() => update(i, { rotation: (t.rotation + 270) % 360 })} className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-accent" aria-label="Rotate left"><RotateCcw className="h-4 w-4" /></button>
              <button type="button" onClick={() => update(i, { rotation: (t.rotation + 90) % 360 })} className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-accent" aria-label="Rotate right"><RotateCw className="h-4 w-4" /></button>
              <button type="button" onClick={() => update(i, { deleted: !t.deleted })} className={cn("rounded-md p-1 hover:bg-surface-2", t.deleted ? "text-accent" : "text-muted hover:text-error")} aria-label={t.deleted ? "Restore page" : "Remove page"}><Trash2 className="h-4 w-4" /></button>
              <button type="button" onClick={() => move(i, i + 1)} className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-accent" aria-label="Move right"><ArrowRight className="h-4 w-4" /></button>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
