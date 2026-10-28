/**
 * Random fixture generation for the tool checker. Everything is built in the
 * browser (canvas, pdf-lib, SheetJS, JSZip and the in-house Office writers), so
 * the checker never needs sample files on disk and every run exercises the
 * tools with fresh, slightly different data.
 */
import type { ToolDefinition } from "@/types/tool";

/* ----- Seeded randomness (so a run can be reproduced from its seed) ----- */

export class Rng {
  private s: number;
  constructor(seed: number) { this.s = (seed >>> 0) || 1; }
  next(): number { // mulberry32
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(min: number, max: number) { return min + Math.floor(this.next() * (max - min + 1)); }
  pick<T>(arr: readonly T[]): T { return arr[Math.floor(this.next() * arr.length)]; }
  amount(min = 10, max = 5000) { return Math.round((min + this.next() * (max - min)) * 100) / 100; }
  date(startYear = 2025, endYear = 2026) {
    const d = new Date(Date.UTC(this.int(startYear, endYear), this.int(0, 11), this.int(1, 28)));
    return d.toISOString().slice(0, 10);
  }
  words(n: number) { return Array.from({ length: n }, () => this.pick(WORDS)).join(" "); }
  sentence() { const w = this.words(this.int(6, 14)); return w[0].toUpperCase() + w.slice(1) + "."; }
  paragraph(n = 4) { return Array.from({ length: n }, () => this.sentence()).join(" "); }
  name() { return `${this.pick(FIRST)} ${this.pick(LAST)}`; }
  company() { return `${this.pick(COMPANY)} ${this.pick(["LLC", "Inc", "Co", "Partners", "Group"])}`; }
  hex() { return "#" + Array.from({ length: 6 }, () => "0123456789ABCDEF"[this.int(0, 15)]).join(""); }
}

const WORDS = ["ledger", "invoice", "quarter", "payroll", "client", "balance", "review", "forecast", "margin", "revenue", "expense", "audit", "report", "summary", "budget", "cash", "statement", "vendor", "deposit", "transfer", "reconcile", "schedule", "estimate", "tax", "office", "software", "travel", "meeting", "proposal", "contract"];
const FIRST = ["Priya", "Rahul", "Maya", "Daniel", "Sofia", "Arjun", "Elena", "Marcus", "Nina", "Omar"];
const LAST = ["Shah", "Ojha", "Patel", "Garcia", "Chen", "Nguyen", "Brown", "Kaur", "Rossi", "Walker"];
const COMPANY = ["Acme", "Globex", "Initech", "Northwind", "Umbrella", "Vandelay", "Stark", "Wayne", "Hooli", "Pied Piper"];
export const VENDORS = ["Amazon Web Services", "Uber Trip", "Stripe Payout", "Gusto Payroll", "Office Depot", "Zoom Video", "Delta Airlines", "Google Workspace", "WeWork Rent", "Chase Bank Fee", "Starbucks", "Adobe Creative Cloud"];

/* ----- Text fixtures ----- */

export const LEDGER_HEADER = ["Date", "Description", "Amount", "Debit", "Credit", "Customer", "Invoice Date", "Due Date", "Account", "Category", "Memo"];

export function ledgerCsv(rng: Rng, rows = 25, opts: { dupes?: boolean } = {}): string {
  const lines = [LEDGER_HEADER.join(",")];
  const out: string[][] = [];
  for (let i = 0; i < rows; i++) {
    const amt = rng.amount(-2500, 4000);
    const inv = rng.date();
    const due = new Date(inv); due.setUTCDate(due.getUTCDate() + rng.pick([15, 30, 45, 60]));
    out.push([
      rng.date(), rng.pick(VENDORS) + " " + rng.int(100, 999), amt.toFixed(2),
      amt < 0 ? Math.abs(amt).toFixed(2) : "", amt > 0 ? amt.toFixed(2) : "",
      rng.company(), inv, due.toISOString().slice(0, 10), rng.pick(["Checking 1234", "Savings 5678", "Credit 9012"]),
      rng.pick(["Office Supplies", "Travel", "Payroll", "Revenue", "Software"]), rng.words(3),
    ]);
  }
  if (opts.dupes) out.push([...out[0]], [...out[1]]);
  for (const r of out) lines.push(r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(","));
  return lines.join("\n");
}

export function simpleCsv(rng: Rng, rows = 8): string {
  const lines = ["Name,Amount,Date,Status"];
  for (let i = 0; i < rows; i++) lines.push(`${rng.company()},${rng.amount().toFixed(2)},${rng.date()},${rng.pick(["Paid", "Open", "Overdue"])}`);
  return lines.join("\n");
}

export function jsonSample(rng: Rng): string {
  const items = Array.from({ length: rng.int(3, 6) }, (_, i) => ({ id: i + 1, name: rng.company(), amount: rng.amount(), paid: rng.next() > 0.5, tags: [rng.pick(WORDS), rng.pick(WORDS)], contact: { email: `${rng.pick(FIRST).toLowerCase()}@example.com`, city: rng.pick(["Austin", "Denver", "Boston"]) } }));
  return JSON.stringify(items);
}

export function xmlSample(rng: Rng): string {
  const rows = Array.from({ length: rng.int(2, 5) }, (_, i) => `<invoice id="${i + 1}"><vendor>${rng.company()}</vendor><amount>${rng.amount()}</amount><date>${rng.date()}</date></invoice>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><invoices>${rows}</invoices>`;
}

export function yamlSample(rng: Rng): string {
  return `client: ${rng.company()}\nowner: ${rng.name()}\ninvoices:\n  - id: 1\n    amount: ${rng.amount()}\n    paid: true\n  - id: 2\n    amount: ${rng.amount()}\n    paid: false\nnotes: ${rng.sentence()}\n`;
}

export function htmlSample(rng: Rng): string {
  return `<!doctype html><html><head><title>${rng.company()}</title><meta name="description" content="${rng.sentence()}"></head><body><h1>${rng.words(3)}</h1><p>${rng.paragraph(2)} <a href="https://example.com">link</a></p><ul><li>${rng.words(2)}</li><li>${rng.words(2)}</li></ul><table><tr><th>Item</th><th>Fee</th></tr><tr><td>${rng.words(2)}</td><td>$${rng.amount()}</td></tr></table></body></html>`;
}

export function markdownSample(rng: Rng): string {
  return `# ${rng.company()} review\n\n## Highlights\n- ${rng.sentence()}\n- ${rng.sentence()}\n- Revenue up ${rng.int(3, 30)}%\n\n## Risks\n| Risk | Owner | Amount |\n| --- | --- | --- |\n| ${rng.words(2)} | ${rng.name()} | $${rng.amount()} |\n| ${rng.words(2)} | ${rng.name()} | $${rng.amount()} |\n\n${rng.paragraph(3)}\n\n\`\`\`js\nconst total = ${rng.int(1, 99)} * 2;\n\`\`\`\n`;
}

export function sqlSample(rng: Rng): string {
  return `select c.name, sum(i.amount) as total from invoices i join clients c on c.id = i.client_id where i.date >= '${rng.date()}' and i.status in ('paid','open') group by c.name having sum(i.amount) > ${rng.int(100, 999)} order by total desc limit 10;`;
}

export function cssSample(rng: Rng): string {
  return `.card{display:flex;gap:${rng.int(4, 24)}px;padding:1rem;border-radius:${rng.int(2, 16)}px;background:${rng.hex()}}.card:hover{opacity:.9}@media (max-width:640px){.card{flex-direction:column}}`;
}

export function jsSample(rng: Rng): string {
  return `function total(items){return items.filter(i=>i.paid).reduce((s,i)=>s+i.amount,0)}const data=[{amount:${rng.amount()},paid:true},{amount:${rng.amount()},paid:false}];console.log(total(data));`;
}

export function jwtSample(rng: Rng): string {
  const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: String(rng.int(1000, 9999)), name: rng.name(), iat: 1735689600, exp: 1767225600 })}.c2lnbmF0dXJl`;
}

export function proseSample(rng: Rng): string {
  const lines = [rng.paragraph(4), "", rng.paragraph(3), "", `Action: ${rng.name()} to send the ${rng.words(2)} by ${rng.date()}.`, `Decision: approve the ${rng.words(2)} budget of $${rng.amount(1000, 20000)}.`];
  return lines.join("\n");
}

export function listSample(rng: Rng, n = 12): string {
  const items = Array.from({ length: n }, () => `${rng.pick(VENDORS)} ${rng.int(1, 50)}`);
  items.push(items[0], " " + items[1] + " "); // duplicate + whitespace variants
  return items.join("\n");
}

export function emailList(rng: Rng): string {
  const list = Array.from({ length: 8 }, () => `${rng.pick(FIRST).toLowerCase()}.${rng.pick(LAST).toLowerCase()}@${rng.pick(["example.com", "gmail.com", "mailinator.com", "omnifi.co"])}`);
  list.push("not-an-email", "INFO@EXAMPLE.COM", list[0]);
  return list.join("\n");
}

/* ----- Binary fixtures ----- */

export function textFile(name: string, text: string, mime = "text/plain"): File {
  return new File([text], name, { type: mime });
}

export async function pngImage(rng: Rng, w = 640, h = 420, label?: string): Promise<File> {
  const blob = await drawImage(rng, w, h, label ?? rng.words(2), "image/png");
  return new File([blob], `sample-${rng.int(100, 999)}.png`, { type: "image/png" });
}

export async function jpegImage(rng: Rng, w = 800, h = 600): Promise<File> {
  const blob = await drawImage(rng, w, h, rng.words(2), "image/jpeg");
  return new File([blob], `photo-${rng.int(100, 999)}.jpg`, { type: "image/jpeg" });
}

/** Image with large, clean text so OCR has something real to read. */
export async function ocrImage(rng: Rng): Promise<{ file: File; text: string }> {
  const canvas = document.createElement("canvas");
  canvas.width = 1000; canvas.height = 400;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, 1000, 400);
  ctx.fillStyle = "#000000"; ctx.font = "bold 44px Arial";
  const lines = [`INVOICE ${rng.int(1000, 9999)}`, `TOTAL DUE ${rng.int(100, 999)} USD`, `DATE ${rng.date()}`];
  lines.forEach((l, i) => ctx.fillText(l, 60, 100 + i * 90));
  const blob = await new Promise<Blob>((res) => canvas.toBlob((b) => res(b!), "image/png"));
  return { file: new File([blob], "scan.png", { type: "image/png" }), text: lines.join("\n") };
}

/** Scanned-looking bank statement page: big monospace transaction lines for OCR. */
export async function ocrStatementImage(rng: Rng): Promise<File> {
  const canvas = document.createElement("canvas");
  canvas.width = 1400; canvas.height = 900;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, 1400, 900);
  ctx.fillStyle = "#000000"; ctx.font = "bold 40px Arial";
  ctx.fillText(`${rng.company().toUpperCase()} BANK STATEMENT`, 60, 80);
  ctx.font = "32px Courier New";
  ctx.fillText("Date        Description                 Amount      Balance", 60, 160);
  let bal = rng.amount(2000, 9000);
  for (let i = 0; i < 10; i++) {
    const amt = rng.amount(-800, 1500);
    bal = Math.round((bal + amt) * 100) / 100;
    const d = `${String(rng.int(1, 12)).padStart(2, "0")}/${String(rng.int(1, 28)).padStart(2, "0")}/2026`;
    ctx.fillText(`${d}  ${rng.pick(VENDORS).toUpperCase().slice(0, 24).padEnd(26, " ")}${amt.toFixed(2).padStart(10, " ")}${bal.toFixed(2).padStart(13, " ")}`, 60, 220 + i * 56);
  }
  const blob = await new Promise<Blob>((res) => canvas.toBlob((b) => res(b!), "image/png"));
  return new File([blob], `statement-scan-${rng.int(100, 999)}.png`, { type: "image/png" });
}

export async function qrImage(text: string): Promise<File> {
  const QR = (await import("qrcode")).default;
  const url = await QR.toDataURL(text, { width: 320, margin: 2 });
  const blob = await (await fetch(url)).blob();
  return new File([blob], "qr.png", { type: "image/png" });
}

export function gifImage(rng: Rng): File {
  // Minimal 2-frame animated GIF (4x4, two solid colours) built by hand.
  const r1 = rng.int(0, 255), g1 = rng.int(0, 255), b1 = rng.int(0, 255);
  const frame = (ci: number) => [0x21, 0xf9, 0x04, 0x04, 0x0a, 0x00, 0x00, 0x00, 0x2c, 0, 0, 0, 0, 4, 0, 4, 0, 0x00, 0x02, 0x04, ci ? 0x84 : 0x04, ci ? 0x8f : 0x0f, 0xa9, 0xcb, 0x00];
  const bytes = new Uint8Array([
    0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 4, 0, 4, 0, 0x91, 0, 0,
    r1, g1, b1, 255 - r1, 255 - g1, 255 - b1, 0, 0, 0, 255, 255, 255,
    0x21, 0xff, 0x0b, 0x4e, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2e, 0x30, 0x03, 0x01, 0, 0, 0x00,
    ...frame(0), ...frame(1), 0x3b,
  ]);
  return new File([bytes], "anim.gif", { type: "image/gif" });
}

async function drawImage(rng: Rng, w: number, h: number, label: string, mime: string): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, rng.hex()); g.addColorStop(1, rng.hex());
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 12; i++) { ctx.fillStyle = rng.hex() + "99"; ctx.beginPath(); ctx.arc(rng.int(0, w), rng.int(0, h), rng.int(10, 80), 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = "#ffffff"; ctx.fillRect(20, 20, w - 40, 70);
  ctx.fillStyle = "#111111"; ctx.font = "bold 36px Arial"; ctx.fillText(label, 36, 68);
  return new Promise((res) => canvas.toBlob((b) => res(b!), mime, 0.92));
}

export async function pdfFile(rng: Rng, opts: { pages?: number; name?: string; withImage?: boolean; marker?: string; form?: boolean } = {}): Promise<File> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = opts.pages ?? rng.int(2, 4);
  let png: Awaited<ReturnType<typeof doc.embedPng>> | null = null;
  if (opts.withImage !== false) png = await doc.embedPng(await (await pngImage(rng, 320, 200, "Figure")).arrayBuffer());
  for (let p = 0; p < pages; p++) {
    const page = doc.addPage([612, 792]);
    let y = 740;
    const title = `${opts.marker ?? "Statement Date"}: ${rng.date()}  Page ${p + 1} of ${pages}`;
    page.drawText(title, { x: 50, y, size: 16, font });
    y -= 30;
    page.drawText(`${rng.company()}  Account ${rng.int(1000, 9999)}  Customer ${rng.name()}  CONFIDENTIAL`, { x: 50, y, size: 11, font });
    y -= 28;
    page.drawText("Date          Description                              Amount", { x: 50, y, size: 10, font, color: rgb(0.2, 0.2, 0.5) });
    y -= 16;
    for (let i = 0; i < 14; i++) {
      page.drawText(`${rng.date()}    ${rng.pick(VENDORS).padEnd(34, " ")}  ${rng.amount(-900, 2500).toFixed(2)}`, { x: 50, y, size: 10, font });
      y -= 15;
    }
    y -= 10;
    page.drawText(rng.paragraph(3), { x: 50, y, size: 9, font, maxWidth: 500, lineHeight: 12 });
    if (png) page.drawImage(png, { x: 50, y: 80, width: 240, height: 150 });
  }
  if (opts.form) {
    const form = doc.getForm();
    const page = doc.getPage(0);
    const tf = form.createTextField("client.name"); tf.setText(rng.name()); tf.addToPage(page, { x: 350, y: 100, width: 200, height: 24 });
    const cb = form.createCheckBox("client.approved"); cb.check(); cb.addToPage(page, { x: 350, y: 140, width: 18, height: 18 });
  }
  doc.setTitle(`${rng.company()} statement`); doc.setAuthor(rng.name());
  const bytes = await doc.save();
  return new File([bytes as BlobPart], opts.name ?? `statement-${rng.int(100, 999)}.pdf`, { type: "application/pdf" });
}

export async function protectedPdf(rng: Rng, password: string): Promise<File> {
  const base = await pdfFile(rng, { pages: 1, withImage: false, name: "locked.pdf" });
  const { PDFDocument } = await import("pdf-lib-plus-encrypt");
  const doc = await PDFDocument.load(await base.arrayBuffer());
  await doc.encrypt({ userPassword: password, ownerPassword: password + "-owner", permissions: { printing: "highResolution", copying: false, modifying: false } });
  return new File([(await doc.save({ useObjectStreams: false })) as BlobPart], "locked.pdf", { type: "application/pdf" });
}

export async function xlsxFile(rng: Rng, opts: { sheets?: number; name?: string; formulas?: boolean; csvText?: string; dupes?: boolean } = {}): Promise<File> {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  const n = opts.sheets ?? 1;
  for (let s = 0; s < n; s++) {
    const csv = opts.csvText ?? ledgerCsv(rng, 20, { dupes: opts.dupes });
    const ws = XLSX.read(csv, { type: "string" }).Sheets.Sheet1;
    if (opts.formulas) {
      ws["L1"] = { t: "s", v: "Total" };
      ws["L2"] = { t: "n", f: "SUM(C2:C21)", v: 0 };
      ws["L3"] = { t: "n", f: "IF(L2>0,L2*1.08,0)", v: 0 };
      ws["L4"] = { t: "e", f: 'VLOOKUP("x",A:B,2,FALSE)', v: 0x2a, w: "#N/A" };
      ws["L5"] = { t: "n", f: "C2+C3+C4+C5", v: 0 };
      ws["L6"] = { t: "n", v: 12345 };
      ws["!ref"] = "A1:L22";
    }
    XLSX.utils.book_append_sheet(wb, ws, s === 0 ? "Ledger" : `Sheet${s + 1}`);
  }
  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return new File([out], opts.name ?? `book-${rng.int(100, 999)}.xlsx`, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

export async function docxFile(rng: Rng, opts: { name?: string; template?: boolean } = {}): Promise<File> {
  const { DocxWriter } = await import("@/processors/shared/docxwriter");
  const w = new DocxWriter(`${rng.company()} engagement`);
  w.heading(opts.template ? "Engagement letter for {{Name}}" : `${rng.company()} engagement summary`, 1);
  w.para(opts.template ? "Dear {{Name}}, your balance of {{Amount}} is due on {{Date}} (status: {{Status}})." : rng.paragraph(3));
  w.heading("Scope", 2);
  w.bullets([rng.sentence(), rng.sentence(), { parts: rng.sentence(), level: 1 }]);
  w.para([{ text: "Bold ", bold: true }, { text: "italic ", italic: true }, { text: "link", link: "https://example.com" }, { text: " and " }, { text: "broken link", link: "https://this-host-does-not-exist.invalid/x" }]);
  w.table([["Item", "Fee", "Date"], [rng.words(2), `$${rng.amount()}`, rng.date()], [rng.words(2), `$${rng.amount()}`, rng.date()]], { header: true });
  const img = await pngImage(rng, 300, 180, "Chart");
  w.image(new Uint8Array(await img.arrayBuffer()), "png", 300, 180, "Figure 1");
  w.heading("Next steps", 2);
  w.bullets([rng.sentence(), rng.sentence()], true);
  const f = await w.save(opts.name ?? `doc-${rng.int(100, 999)}.docx`);
  return new File([f.blob], f.name, { type: f.blob.type || "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
}

export async function pptxFile(rng: Rng, opts: { name?: string; slides?: number } = {}): Promise<File> {
  const { PptxWriter } = await import("@/processors/shared/pptxwriter");
  const w = new PptxWriter(`${rng.company()} review`);
  w.titleSlide(`${rng.company()} quarterly review`, rng.sentence());
  const n = opts.slides ?? rng.int(3, 5);
  for (let i = 0; i < n; i++) w.bulletSlide(`${rng.words(2)} ${i + 1}`, [rng.sentence(), rng.sentence(), { text: rng.sentence(), level: 1 }, "See https://example.com and https://this-host-does-not-exist.invalid/page"], rng.sentence());
  w.tableSlide("Numbers", [["Item", "Q1", "Q2"], [rng.words(1), String(rng.int(1, 99)), String(rng.int(1, 99))], [rng.words(1), String(rng.int(1, 99)), String(rng.int(1, 99))]], { header: true });
  const img = await pngImage(rng, 400, 240, "Figure");
  w.imageSlide("Figure", new Uint8Array(await img.arrayBuffer()), "png", 400, 240, "Figure 1");
  w.sectionSlide("Appendix", rng.sentence());
  const f = await w.save(opts.name ?? `deck-${rng.int(100, 999)}.pptx`);
  return new File([f.blob], f.name, { type: f.blob.type || "application/vnd.openxmlformats-officedocument.presentationml.presentation" });
}

export async function zipFile(rng: Rng, files: File[]): Promise<File> {
  const JSZip = (await import("jszip")).default;
  const z = new JSZip();
  for (const f of files) z.file(f.name, await f.arrayBuffer());
  z.file("nested/readme.txt", rng.paragraph(2));
  const blob = await z.generateAsync({ type: "blob" });
  return new File([blob], `bundle-${rng.int(100, 999)}.zip`, { type: "application/zip" });
}

export function wavFile(rng: Rng, seconds = 2): File {
  const rate = 16000, n = rate * seconds;
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); str(8, "WAVE"); str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, "data"); v.setUint32(40, n * 2, true);
  const f1 = rng.int(220, 880), f2 = rng.int(220, 880);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const s = 0.4 * Math.sin(2 * Math.PI * f1 * t) + 0.3 * Math.sin(2 * Math.PI * f2 * t);
    v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, s)) * 32767, true);
  }
  return new File([buf], `tone-${rng.int(100, 999)}.wav`, { type: "audio/wav" });
}

/** Short WebM video recorded from a canvas animation (Chrome/Edge). */
export async function webmVideo(rng: Rng, seconds = 2): Promise<File> {
  if (typeof MediaRecorder === "undefined") throw new Error("MediaRecorder is not available in this browser");
  const canvas = document.createElement("canvas");
  canvas.width = 320; canvas.height = 240;
  const ctx = canvas.getContext("2d")!;
  const stream = canvas.captureStream(15);
  // Add a tone so the clip has an audio track (needed by Extract audio and realistic for converters).
  let audio: { ctx: AudioContext; osc: OscillatorNode } | null = null;
  try {
    const ac = new AudioContext();
    await ac.resume().catch(() => {});
    const osc = ac.createOscillator();
    osc.frequency.value = rng.int(220, 880);
    const dest = ac.createMediaStreamDestination();
    osc.connect(dest);
    osc.start();
    for (const t of dest.stream.getAudioTracks()) stream.addTrack(t);
    audio = { ctx: ac, osc };
  } catch { audio = null; }
  const mime = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const done = new Promise<void>((res) => { rec.onstop = () => res(); });
  const c1 = rng.hex(), c2 = rng.hex();
  let frame = 0;
  const timer = setInterval(() => {
    ctx.fillStyle = frame % 2 ? c1 : c2; ctx.fillRect(0, 0, 320, 240);
    ctx.fillStyle = "#fff"; ctx.font = "28px Arial"; ctx.fillText(`Frame ${frame++}`, 60, 130);
  }, 1000 / 15);
  rec.start(250);
  await new Promise((r) => setTimeout(r, seconds * 1000));
  clearInterval(timer);
  rec.stop();
  await done;
  stream.getTracks().forEach((t) => t.stop());
  if (audio) { try { audio.osc.stop(); await audio.ctx.close(); } catch { /* ignore */ } }
  return new File([new Blob(chunks, { type: "video/webm" })], `clip-${rng.int(100, 999)}.webm`, { type: "video/webm" });
}

/* ----- Choosing an input format for a tool ----- */

export type InputKind = "pdf" | "png" | "jpg" | "gif" | "csv" | "xlsx" | "docx" | "pptx" | "zip" | "txt" | "wav" | "webm" | "any";

export function inputKinds(tool: ToolDefinition): InputKind[] {
  const kinds: InputKind[] = [];
  const add = (k: InputKind) => { if (!kinds.includes(k)) kinds.push(k); };
  for (const i of tool.input) {
    const s = i.toLowerCase();
    if (s === "*") add("any");
    else if (s === "pdf") add("pdf");
    else if (s === "image/png") add("png");
    else if (s === "image/jpeg") add("jpg");
    else if (s === "image/gif") add("gif");
    else if (s === "image/webp" || s === "image/bmp" || s === "image/tiff") continue;
    else if (s === "csv" || s === "tsv") add("csv");
    else if (s === "xlsx" || s === "xls" || s === "xlsm") add("xlsx");
    else if (s === "docx") add("docx");
    else if (s === "pptx") add("pptx");
    else if (s === "zip") add("zip");
    else if (s === "txt" || s === "md") add("txt");
    else if (s.startsWith("audio") || ["mp3", "wav", "m4a", "ogg", "aac", "flac"].includes(s)) add("wav");
    else if (s.startsWith("video") || ["mp4", "mov", "mkv", "webm", "avi"].includes(s)) add("webm");
  }
  return kinds;
}
