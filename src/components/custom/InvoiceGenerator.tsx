"use client";
import { useState } from "react";
import { Download, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input, Label, Textarea } from "@/components/ui/Input";
import { ResultPanel } from "@/components/tools/ResultPanel";
import type { ProcessorOutput } from "@/types/processor";

interface Line { desc: string; qty: number; rate: number }

const today = () => { const d = new Date(); return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`; };

export function InvoiceGenerator() {
  const [from, setFrom] = useState("Omnifi LLC\n");
  const [to, setTo] = useState("");
  const [number, setNumber] = useState(`INV-${new Date().getFullYear()}-001`);
  const [date, setDate] = useState(today());
  const [due, setDue] = useState("Net 30");
  const [taxPct, setTaxPct] = useState(0);
  const [notes, setNotes] = useState("Thank you for your business.");
  const [lines, setLines] = useState<Line[]>([{ desc: "Monthly bookkeeping", qty: 1, rate: 1500 }]);
  const [output, setOutput] = useState<ProcessorOutput | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const subtotal = lines.reduce((a, l) => a + l.qty * l.rate, 0);
  const tax = subtotal * (taxPct / 100);
  const total = subtotal + tax;
  const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

  const build = async () => {
    setBusy(true);
    setError(null);
    try {
      const { PdfWriter, NAVY, MUTED, BODY, resetStripped } = await import("@/processors/shared/pdfwriter");
      const { fileFromBytes } = await import("@/processors/shared/output");
      resetStripped();
      const pw = await PdfWriter.create({ margin: 50 });
      pw.text("INVOICE", { size: 26, bold: true, color: NAVY, spaceAfter: 2 });
      pw.text(`${number}   ·   Date ${date}   ·   Terms ${due}`, { size: 10, color: MUTED, spaceAfter: 18 });
      const y0 = pw.y;
      pw.text("From", { size: 9, bold: true, color: MUTED, spaceAfter: 2 });
      pw.text(from.trim() || "—", { size: 10, color: BODY, spaceAfter: 10 });
      const yLeft = pw.y;
      pw.y = y0;
      const col = pw.margin + pw.contentWidth / 2;
      const savedMargin = pw.margin;
      // Right column: draw at an x offset by temporarily using indent.
      pw.text("Bill to", { size: 9, bold: true, color: MUTED, indent: pw.contentWidth / 2, spaceAfter: 2 });
      pw.text(to.trim() || "—", { size: 10, color: BODY, indent: pw.contentWidth / 2, spaceAfter: 10 });
      void col; void savedMargin;
      pw.y = Math.min(pw.y, yLeft) - 10;
      const rows = [["Description", "Qty", "Rate", "Amount"], ...lines.filter((l) => l.desc.trim()).map((l) => [l.desc, String(l.qty), money(l.rate), money(l.qty * l.rate)])];
      pw.table(rows, { header: true, fontSize: 10, colWidths: [pw.contentWidth * 0.52, pw.contentWidth * 0.12, pw.contentWidth * 0.18, pw.contentWidth * 0.18] });
      pw.text(`Subtotal   ${money(subtotal)}`, { size: 10, align: "right", color: BODY, spaceAfter: 2 });
      if (taxPct > 0) pw.text(`Tax (${taxPct}%)   ${money(tax)}`, { size: 10, align: "right", color: BODY, spaceAfter: 2 });
      pw.text(`Total due   ${money(total)}`, { size: 14, bold: true, align: "right", color: NAVY, spaceAfter: 16 });
      if (notes.trim()) pw.text(notes.trim(), { size: 10, color: MUTED });
      pw.footer(`${number} · ${from.split("\n")[0]}`);
      const bytes = await pw.save();
      setOutput({ files: [fileFromBytes(`${number.replace(/[^a-z0-9-]+/gi, "-")}.pdf`, bytes, "application/pdf")], stats: { Total: money(total), Lines: String(lines.length) } });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not build the PDF");
    } finally {
      setBusy(false);
    }
  };

  if (output) return <ResultPanel output={output} onReset={() => setOutput(null)} title="Invoice ready" />;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div><Label htmlFor="inv-from">From</Label><Textarea id="inv-from" value={from} onChange={(e) => setFrom(e.target.value)} className="min-h-[90px] font-sans" placeholder="Your company&#10;Address&#10;Email" /></div>
        <div><Label htmlFor="inv-to">Bill to</Label><Textarea id="inv-to" value={to} onChange={(e) => setTo(e.target.value)} className="min-h-[90px] font-sans" placeholder="Client name&#10;Address&#10;Email" /></div>
        <div><Label htmlFor="inv-no">Invoice number</Label><Input id="inv-no" value={number} onChange={(e) => setNumber(e.target.value)} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label htmlFor="inv-date">Date</Label><Input id="inv-date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div><Label htmlFor="inv-due">Terms</Label><Input id="inv-due" value={due} onChange={(e) => setDue(e.target.value)} /></div>
        </div>
      </div>
      <div>
        <h3 className="mb-2 text-sm font-semibold text-foreground">Line items</h3>
        <div className="space-y-2">
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-[1fr_80px_110px_auto] items-center gap-2">
              <Input aria-label="Description" value={l.desc} onChange={(e) => setLines((s) => s.map((x, k) => (k === i ? { ...x, desc: e.target.value } : x)))} placeholder="Description" />
              <Input aria-label="Quantity" type="number" min={0} step="any" value={l.qty} onChange={(e) => setLines((s) => s.map((x, k) => (k === i ? { ...x, qty: Number(e.target.value) } : x)))} />
              <Input aria-label="Rate" type="number" min={0} step="0.01" value={l.rate} onChange={(e) => setLines((s) => s.map((x, k) => (k === i ? { ...x, rate: Number(e.target.value) } : x)))} />
              <button type="button" onClick={() => setLines((s) => s.filter((_, k) => k !== i))} className="rounded-md p-2 text-muted hover:bg-surface-2 hover:text-error" aria-label="Remove line" disabled={lines.length === 1}><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
        </div>
        <Button variant="ghost" size="sm" className="mt-2" onClick={() => setLines((s) => [...s, { desc: "", qty: 1, rate: 0 }])}><Plus className="h-4 w-4" /> Add line</Button>
      </div>
      <div className="grid gap-4 sm:grid-cols-[160px_1fr]">
        <div><Label htmlFor="inv-tax">Tax %</Label><Input id="inv-tax" type="number" min={0} step="0.01" value={taxPct} onChange={(e) => setTaxPct(Number(e.target.value))} /></div>
        <div><Label htmlFor="inv-notes">Notes / payment instructions</Label><Input id="inv-notes" value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
      </div>
      <div className="flex flex-wrap items-center gap-4 rounded-control border border-border bg-surface-2 px-4 py-3 text-sm">
        <span className="text-muted">Subtotal <span className="font-mono text-foreground">{money(subtotal)}</span></span>
        {taxPct > 0 && <span className="text-muted">Tax <span className="font-mono text-foreground">{money(tax)}</span></span>}
        <span className="text-muted">Total <span className="font-mono text-lg text-accent">{money(total)}</span></span>
        <Button className="ml-auto" onClick={build} loading={busy}><Download className="h-4 w-4" /> Download PDF</Button>
      </div>
      {error && <p className="rounded-control-sm bg-error-soft px-3 py-2 text-sm">{error}</p>}
    </div>
  );
}
