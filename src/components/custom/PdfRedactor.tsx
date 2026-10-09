"use client";
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Eraser, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input, Label, Textarea } from "@/components/ui/Input";
import { PdfToolShell, useOutput } from "./PdfToolShell";
import type { RedactBox } from "@/processors/pdf/advanced";
import type { ProcessorOutput } from "@/types/processor";

export function PdfRedactor() {
  const o = useOutput();
  return (
    <PdfToolShell hint="Draw boxes over anything sensitive, or list words to find automatically." output={o.output} onReset={o.reset} progress={o.progress}>
      {(file) => <Editor file={file} onDone={o.setOutput} setProgress={o.setProgress} />}
    </PdfToolShell>
  );
}

type PdfDoc = Awaited<ReturnType<typeof import("@/processors/shared/pdfjs").openPdf>>;

function Editor({ file, onDone, setProgress }: { file: File; onDone: (o: ProcessorOutput) => void; setProgress: (p: { value: number; label?: string } | null) => void }) {
  const [doc, setDoc] = useState<PdfDoc | null>(null);
  const [page, setPage] = useState(1);
  const [boxes, setBoxes] = useState<RedactBox[]>([]);
  const [terms, setTerms] = useState("");
  const [termBoxes, setTermBoxes] = useState<RedactBox[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [scale, setScale] = useState(1);
  const [pageSize, setPageSize] = useState({ w: 612, h: 792 });
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const [live, setLive] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { openPdf } = await import("@/processors/shared/pdfjs");
      try {
        const d = await openPdf(file);
        if (!cancelled) setDoc(d);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not open this PDF");
      }
    })();
    return () => { cancelled = true; };
  }, [file]);

  useEffect(() => {
    if (!doc || !canvasRef.current) return;
    let cancelled = false;
    (async () => {
      const { renderPage } = await import("@/processors/shared/pdfjs");
      const p = await doc.getPage(page);
      const vp = p.getViewport({ scale: 1 });
      const target = Math.min(1.5, (canvasRef.current!.parentElement!.clientWidth - 2) / vp.width);
      const canvas = await renderPage(doc, page, target);
      if (cancelled) return;
      const c = canvasRef.current!;
      c.width = canvas.width;
      c.height = canvas.height;
      c.getContext("2d")!.drawImage(canvas as CanvasImageSource, 0, 0);
      setScale(target);
      setPageSize({ w: vp.width, h: vp.height });
    })();
    return () => { cancelled = true; };
  }, [doc, page]);

  const pos = (e: React.MouseEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (canvasRef.current!.width / r.width) / scale, y: (e.clientY - r.top) * (canvasRef.current!.height / r.height) / scale };
  };
  const onDown = (e: React.MouseEvent) => { dragRef.current = pos(e); };
  const onMove = (e: React.MouseEvent) => {
    if (!dragRef.current) return;
    const p = pos(e);
    setLive({ x: Math.min(p.x, dragRef.current.x), y: Math.min(p.y, dragRef.current.y), w: Math.abs(p.x - dragRef.current.x), h: Math.abs(p.y - dragRef.current.y) });
  };
  const onUp = () => {
    if (live && live.w > 3 && live.h > 3) setBoxes((b) => [...b, { page, x: live.x, y: pageSize.h - live.y - live.h, w: live.w, h: live.h }]);
    dragRef.current = null;
    setLive(null);
  };

  const search = async () => {
    const list = terms.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
    if (!list.length) return;
    setBusy(true);
    try {
      const { findTermBoxes } = await import("@/processors/pdf/advanced");
      const found = await findTermBoxes(file, list, (f) => setProgress({ value: f, label: "Searching" }));
      setTermBoxes(found);
      if (!found.length) setError("No matches found. Scanned PDFs need OCR first.");
      else setError(null);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const apply = async () => {
    setBusy(true);
    try {
      const { applyRedaction } = await import("@/processors/pdf/advanced");
      const out = await applyRedaction(file, [...boxes, ...termBoxes], (v, l) => setProgress({ value: v, label: l }));
      await doc?.loadingTask.destroy().catch(() => {});
      onDone(out);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Redaction failed");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const pageBoxes = [...boxes, ...termBoxes].filter((b) => b.page === page);
  const total = boxes.length + termBoxes.length;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
      <div>
        <div className="mb-2 flex items-center justify-between text-sm">
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}><ChevronLeft className="h-4 w-4" /></Button>
            <span className="tabular-nums text-body">Page {page} / {doc?.numPages ?? "…"}</span>
            <Button variant="ghost" size="sm" onClick={() => setPage((p) => Math.min(doc?.numPages ?? 1, p + 1))} disabled={!doc || page >= doc.numPages}><ChevronRight className="h-4 w-4" /></Button>
          </div>
          <span className="text-xs text-muted">Drag on the page to draw a box</span>
        </div>
        <div className="relative select-none overflow-hidden rounded-control border border-border bg-surface-2">
          <canvas ref={canvasRef} className="block w-full cursor-crosshair" onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp} />
          {pageBoxes.map((b, i) => (
            <div key={i} className="pointer-events-none absolute bg-black/85 ring-1 ring-accent" style={{ left: `${(b.x / pageSize.w) * 100}%`, top: `${((pageSize.h - b.y - b.h) / pageSize.h) * 100}%`, width: `${(b.w / pageSize.w) * 100}%`, height: `${(b.h / pageSize.h) * 100}%` }} />
          ))}
          {live && <div className="pointer-events-none absolute border-2 border-accent bg-accent/20" style={{ left: `${(live.x / pageSize.w) * 100}%`, top: `${(live.y / pageSize.h) * 100}%`, width: `${(live.w / pageSize.w) * 100}%`, height: `${(live.h / pageSize.h) * 100}%` }} />}
        </div>
      </div>
      <aside className="space-y-4">
        <div>
          <Label htmlFor="redact-terms" hint="One per line. Matches on every page.">Words or phrases to black out</Label>
          <Textarea id="redact-terms" value={terms} onChange={(e) => setTerms(e.target.value)} className="min-h-[90px] font-sans" placeholder="123-45-6789&#10;Acme Holdings" />
          <Button className="mt-2 w-full" variant="secondary" size="sm" onClick={search} loading={busy}><Search className="h-4 w-4" /> Find matches</Button>
        </div>
        <div className="rounded-control border border-border bg-surface p-3 text-sm">
          <p className="font-medium text-foreground">{total} area{total === 1 ? "" : "s"} marked</p>
          <p className="text-xs text-muted">{boxes.length} drawn · {termBoxes.length} from search</p>
          <div className="mt-2 flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => setBoxes((b) => b.filter((x) => x.page !== page))} disabled={!boxes.some((b) => b.page === page)}><Eraser className="h-4 w-4" /> Clear page</Button>
            <Button variant="ghost" size="sm" onClick={() => { setBoxes([]); setTermBoxes([]); }} disabled={!total}><Trash2 className="h-4 w-4" /> Clear all</Button>
          </div>
        </div>
        <Button className="w-full" onClick={apply} disabled={!total || busy} loading={busy}>Apply redaction &amp; download</Button>
        <p className="text-xs text-muted">Redacted pages are flattened to images so the text underneath is truly gone, not just covered.</p>
        {error && <p className="rounded-control-sm bg-error-soft px-3 py-2 text-xs text-foreground">{error}</p>}
      </aside>
    </div>
  );
}

export { Input };
