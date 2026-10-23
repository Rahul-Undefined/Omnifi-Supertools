"use client";
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Type, Square, Highlighter, Eraser, Pencil, ImagePlus, Undo2, Trash2, Check, MousePointer2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";
import { PdfToolShell, useOutput } from "./PdfToolShell";
import type { EditItem } from "@/processors/pdf/editor";
import type { ProcessorOutput } from "@/types/processor";

/**
 * In-browser PDF editor: add text, boxes, highlights, white-out, free-hand
 * drawing, check marks and images on any page, then burn them into the PDF.
 * Coordinates are kept in PDF points (origin bottom-left) so the result is
 * resolution independent.
 */
export function PdfEditor() {
  const o = useOutput();
  return (
    <PdfToolShell hint="Add text, highlights, boxes, drawings, white-out or an image, then apply." output={o.output} onReset={o.reset} progress={o.progress}>
      {(file) => <Editor file={file} onDone={o.setOutput} setProgress={o.setProgress} />}
    </PdfToolShell>
  );
}

type PdfDoc = Awaited<ReturnType<typeof import("@/processors/shared/pdfjs").openPdf>>;
type Tool = "select" | "text" | "rect" | "highlight" | "whiteout" | "draw" | "check" | "image";
type Pt = { x: number; y: number };

function Editor({ file, onDone, setProgress }: { file: File; onDone: (o: ProcessorOutput) => void; setProgress: (p: { value: number; label?: string } | null) => void }) {
  const [doc, setDoc] = useState<PdfDoc | null>(null);
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<EditItem[]>([]);
  const [tool, setTool] = useState<Tool>("text");
  const [color, setColor] = useState("#1F3A93");
  const [size, setSize] = useState(12);
  const [stroke, setStroke] = useState(2);
  const [fill, setFill] = useState(false);
  const [textDraft, setTextDraft] = useState<{ x: number; y: number; value: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const [scale, setScale] = useState(1);
  const [pageSize, setPageSize] = useState({ w: 612, h: 792 });
  const dragRef = useRef<Pt | null>(null);
  const pathRef = useRef<Pt[]>([]);
  const [live, setLive] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [pendingImage, setPendingImage] = useState<{ bytes: Uint8Array; mime: string; w: number; h: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { openPdf } = await import("@/processors/shared/pdfjs");
      try { const d = await openPdf(file); if (!cancelled) setDoc(d); }
      catch (e) { if (!cancelled) setError(e instanceof Error ? e.message : "Could not open this PDF"); }
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
      const target = Math.min(1.6, Math.max(0.4, (canvasRef.current!.parentElement!.clientWidth - 2) / vp.width));
      const canvas = await renderPage(doc, page, target);
      if (cancelled) return;
      const c = canvasRef.current!;
      c.width = canvas.width; c.height = canvas.height;
      c.getContext("2d")!.drawImage(canvas as CanvasImageSource, 0, 0);
      if (overlayRef.current) { overlayRef.current.width = canvas.width; overlayRef.current.height = canvas.height; }
      setScale(target);
      setPageSize({ w: vp.width, h: vp.height });
    })();
    return () => { cancelled = true; };
  }, [doc, page]);

  // Draw existing items + live shape on the overlay.
  useEffect(() => {
    const ov = overlayRef.current;
    if (!ov) return;
    const g = ov.getContext("2d")!;
    g.clearRect(0, 0, ov.width, ov.height);
    const X = (x: number) => x * scale, Y = (y: number) => (pageSize.h - y) * scale;
    for (const it of items) {
      if (it.page !== page) continue;
      g.save();
      if (it.kind === "text") { g.fillStyle = it.color; g.font = `${it.bold ? "bold " : ""}${it.size * scale}px Helvetica, Arial, sans-serif`; it.text.split(/\r?\n/).forEach((l, k) => g.fillText(l, X(it.x), Y(it.y) + k * it.size * 1.25 * scale)); }
      else if (it.kind === "rect") { g.strokeStyle = it.color; g.lineWidth = it.stroke * scale; g.globalAlpha = it.opacity; if (it.fill) { g.fillStyle = it.color; g.fillRect(X(it.x), Y(it.y + it.h), it.w * scale, it.h * scale); } g.strokeRect(X(it.x), Y(it.y + it.h), it.w * scale, it.h * scale); }
      else if (it.kind === "highlight") { g.fillStyle = it.color; g.globalAlpha = 0.35; g.fillRect(X(it.x), Y(it.y + it.h), it.w * scale, it.h * scale); }
      else if (it.kind === "whiteout") { g.fillStyle = "#fff"; g.fillRect(X(it.x), Y(it.y + it.h), it.w * scale, it.h * scale); g.strokeStyle = "#c9ccf0"; g.setLineDash([4, 3]); g.strokeRect(X(it.x), Y(it.y + it.h), it.w * scale, it.h * scale); }
      else if (it.kind === "line") { g.strokeStyle = it.color; g.lineWidth = it.width * scale; g.lineCap = "round"; g.lineJoin = "round"; g.beginPath(); it.points.forEach((p, k) => (k ? g.lineTo(X(p.x), Y(p.y)) : g.moveTo(X(p.x), Y(p.y)))); g.stroke(); }
      else if (it.kind === "check") { g.fillStyle = it.color; g.font = `bold ${it.size * scale}px Helvetica, Arial`; g.fillText("✓", X(it.x), Y(it.y)); }
      else if (it.kind === "image") { g.strokeStyle = "#4F5BD5"; g.setLineDash([6, 4]); g.strokeRect(X(it.x), Y(it.y + it.h), it.w * scale, it.h * scale); g.fillStyle = "#4F5BD5"; g.font = `${11 * scale}px sans-serif`; g.fillText("image", X(it.x) + 4, Y(it.y + it.h) + 14 * scale); }
      g.restore();
    }
    if (live) { g.save(); g.strokeStyle = tool === "whiteout" ? "#999" : color; g.setLineDash([5, 4]); g.lineWidth = 1; g.strokeRect(live.x, live.y, live.w, live.h); g.restore(); }
    if (tool === "draw" && pathRef.current.length > 1) { g.save(); g.strokeStyle = color; g.lineWidth = stroke * scale; g.lineCap = "round"; g.beginPath(); pathRef.current.forEach((p, k) => (k ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.stroke(); g.restore(); }
  }, [items, live, page, scale, pageSize, tool, color, stroke]);

  const toPdf = (px: number, py: number): Pt => ({ x: px / scale, y: pageSize.h - py / scale });
  const pos = (e: React.PointerEvent) => { const r = overlayRef.current!.getBoundingClientRect(); return { x: (e.clientX - r.left) * (overlayRef.current!.width / r.width), y: (e.clientY - r.top) * (overlayRef.current!.height / r.height) }; };

  const onDown = (e: React.PointerEvent) => {
    const p = pos(e);
    if (tool === "text") { const pt = toPdf(p.x, p.y); setTextDraft({ x: pt.x, y: pt.y, value: "" }); return; }
    if (tool === "check") { const pt = toPdf(p.x, p.y); setItems((s) => [...s, { kind: "check", page, x: pt.x, y: pt.y - size * 0.75, size, color }]); return; }
    if (tool === "image") {
      if (!pendingImage) { setError("Choose an image file first (button above the page)."); return; }
      const pt = toPdf(p.x, p.y); const w = Math.min(pageSize.w * 0.4, pendingImage.w / 2); const h = (pendingImage.h / pendingImage.w) * w;
      setItems((s) => [...s, { kind: "image", page, x: pt.x, y: pt.y - h, w, h, bytes: pendingImage.bytes, mime: pendingImage.mime }]);
      return;
    }
    if (tool === "select") return;
    (e.target as Element).setPointerCapture(e.pointerId);
    dragRef.current = p;
    pathRef.current = tool === "draw" ? [p] : [];
  };
  const onMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const p = pos(e);
    if (tool === "draw") { pathRef.current.push(p); setLive({ x: 0, y: 0, w: 0, h: 0 }); return; }
    setLive({ x: Math.min(dragRef.current.x, p.x), y: Math.min(dragRef.current.y, p.y), w: Math.abs(p.x - dragRef.current.x), h: Math.abs(p.y - dragRef.current.y) });
  };
  const onUp = () => {
    if (!dragRef.current) return;
    if (tool === "draw") {
      const pts = pathRef.current.map((p) => toPdf(p.x, p.y));
      if (pts.length > 1) setItems((s) => [...s, { kind: "line", page, points: pts, color, width: stroke }]);
    } else if (live && live.w > 3 && live.h > 3) {
      const a = toPdf(live.x, live.y + live.h);
      const w = live.w / scale, h = live.h / scale;
      if (tool === "rect") setItems((s) => [...s, { kind: "rect", page, x: a.x, y: a.y, w, h, color, fill, opacity: fill ? 0.3 : 1, stroke }]);
      else if (tool === "highlight") setItems((s) => [...s, { kind: "highlight", page, x: a.x, y: a.y, w, h, color: color === "#1F3A93" ? "#FFEB3B" : color }]);
      else if (tool === "whiteout") setItems((s) => [...s, { kind: "whiteout", page, x: a.x, y: a.y, w, h }]);
    }
    dragRef.current = null; pathRef.current = []; setLive(null);
  };

  const commitText = () => {
    if (textDraft && textDraft.value.trim()) setItems((s) => [...s, { kind: "text", page, x: textDraft.x, y: textDraft.y - size, text: textDraft.value, size, color, bold: false }]);
    setTextDraft(null);
  };

  const pickImage = async (f: File | undefined) => {
    if (!f) return;
    const { blobToCanvas, canvasToBlob } = await import("@/processors/shared/canvas");
    let bytes: Uint8Array; let mime = f.type;
    if (f.type === "image/png" || f.type === "image/jpeg") bytes = new Uint8Array(await f.arrayBuffer());
    else { const { canvas } = await blobToCanvas(f); bytes = new Uint8Array(await (await canvasToBlob(canvas, "image/png")).arrayBuffer()); mime = "image/png"; }
    const { canvas } = await blobToCanvas(f);
    setPendingImage({ bytes, mime, w: canvas.width, h: canvas.height });
    setTool("image");
  };

  const apply = async () => {
    setBusy(true); setError(null);
    try {
      const { applyEdits } = await import("@/processors/pdf/editor");
      onDone(await applyEdits(file, items, (v, l) => setProgress({ value: v, label: l })));
    } catch (e) { setError(e instanceof Error ? e.message : "Could not apply the edits"); }
    finally { setBusy(false); setProgress(null); }
  };

  const tools: { id: Tool; icon: React.ReactNode; label: string }[] = [
    { id: "select", icon: <MousePointer2 className="h-4 w-4" />, label: "Pan" },
    { id: "text", icon: <Type className="h-4 w-4" />, label: "Text" },
    { id: "highlight", icon: <Highlighter className="h-4 w-4" />, label: "Highlight" },
    { id: "rect", icon: <Square className="h-4 w-4" />, label: "Box" },
    { id: "draw", icon: <Pencil className="h-4 w-4" />, label: "Draw" },
    { id: "whiteout", icon: <Eraser className="h-4 w-4" />, label: "White-out" },
    { id: "check", icon: <Check className="h-4 w-4" />, label: "Check mark" },
  ];
  const onThisPage = items.filter((i) => i.page === page).length;

  if (error && !doc) return <p className="text-sm text-error">{error}</p>;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-control border border-border bg-surface p-3">
        {tools.map((t) => <button key={t.id} type="button" onClick={() => setTool(t.id)} className={`inline-flex h-9 items-center gap-1.5 rounded-control-sm px-3 text-sm ${tool === t.id ? "bg-accent text-white" : "bg-surface-2 text-body hover:bg-surface-3"}`}>{t.icon}{t.label}</button>)}
        <label className={`inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-control-sm px-3 text-sm ${tool === "image" ? "bg-accent text-white" : "bg-surface-2 text-body hover:bg-surface-3"}`}><ImagePlus className="h-4 w-4" /> Image<input type="file" accept="image/*" className="hidden" onChange={(e) => void pickImage(e.target.files?.[0])} /></label>
        <span className="mx-1 h-6 w-px bg-border" />
        <label className="inline-flex items-center gap-1.5 text-xs text-muted">Colour <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-8 w-10 cursor-pointer rounded border border-border bg-transparent" /></label>
        <label className="inline-flex items-center gap-1.5 text-xs text-muted">Size <Input type="number" value={size} min={6} max={72} onChange={(e) => setSize(Number(e.target.value) || 12)} className="h-8 w-16 px-2 text-xs" /></label>
        <label className="inline-flex items-center gap-1.5 text-xs text-muted">Line <Input type="number" value={stroke} min={1} max={20} onChange={(e) => setStroke(Number(e.target.value) || 2)} className="h-8 w-14 px-2 text-xs" /></label>
        {tool === "rect" && <label className="inline-flex items-center gap-1.5 text-xs text-muted"><input type="checkbox" checked={fill} onChange={(e) => setFill(e.target.checked)} /> Filled</label>}
        <span className="flex-1" />
        <Button variant="ghost" size="sm" onClick={() => setItems((s) => s.slice(0, -1))} disabled={!items.length}><Undo2 className="h-4 w-4" /> Undo</Button>
        <Button variant="ghost" size="sm" onClick={() => setItems((s) => s.filter((i) => i.page !== page))} disabled={!onThisPage}><Trash2 className="h-4 w-4" /> Clear page</Button>
      </div>

      <div className="flex items-center justify-between text-sm text-muted">
        <span>{tool === "text" ? "Click where the text should start." : tool === "draw" ? "Drag to draw freehand." : tool === "check" ? "Click to place a check mark." : tool === "image" ? (pendingImage ? "Click where the image should go." : "Choose an image, then click to place it.") : tool === "select" ? "Pick a tool to start editing." : "Drag to draw the area."} {onThisPage ? `· ${onThisPage} edit(s) on this page` : ""}</span>
        <span className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}><ChevronLeft className="h-4 w-4" /></Button>
          Page {page} / {doc?.numPages ?? "…"}
          <Button variant="ghost" size="sm" onClick={() => setPage((p) => Math.min(doc?.numPages ?? 1, p + 1))} disabled={!doc || page >= doc.numPages}><ChevronRight className="h-4 w-4" /></Button>
        </span>
      </div>

      <div className="relative w-full overflow-auto rounded-control border border-border bg-surface-2 p-2">
        <div className="relative mx-auto w-fit">
          <canvas ref={canvasRef} className="block max-w-full rounded-sm shadow" />
          <canvas ref={overlayRef} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} className={`absolute left-0 top-0 h-full w-full touch-none ${tool === "select" ? "cursor-default" : tool === "text" || tool === "check" || tool === "image" ? "cursor-text" : "cursor-crosshair"}`} />
          {textDraft && (
            <div className="absolute z-10" style={{ left: textDraft.x * scale, top: (pageSize.h - textDraft.y) * scale }}>
              <textarea autoFocus value={textDraft.value} onChange={(e) => setTextDraft({ ...textDraft, value: e.target.value })} onBlur={commitText} onKeyDown={(e) => { if (e.key === "Escape") setTextDraft(null); if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) commitText(); }} placeholder="Type, then click outside (Ctrl+Enter)" rows={2} className="min-w-[200px] rounded border border-accent bg-white/95 p-1 text-sm text-navy-900 shadow-float" style={{ fontSize: size * scale, color }} />
            </div>
          )}
        </div>
      </div>

      {error && <p className="text-sm text-error">{error}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={apply} loading={busy} disabled={!items.length}><Check className="h-4 w-4" /> Apply {items.length} edit{items.length === 1 ? "" : "s"} and download</Button>
        <Label className="text-xs text-muted">Edits are burned into the page content, so they show in every PDF viewer. Use Redact PDF when something must be removed, not covered.</Label>
      </div>
    </div>
  );
}
