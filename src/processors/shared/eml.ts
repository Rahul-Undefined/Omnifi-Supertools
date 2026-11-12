/**
 * Read an Outlook/Gmail .eml export (RFC 822 / MIME) in the browser and turn the
 * whole conversation into plain text: headers, body (HTML stripped when there is
 * no text part), quoted earlier messages and the list of attachments.
 */
export interface EmlMessage {
  subject: string;
  from: string;
  to: string;
  cc: string;
  date: string;
  text: string;
  attachments: { filename: string; mimeType: string; size: number }[];
}

function addr(list: { name?: string; address?: string }[] | { name?: string; address?: string } | undefined): string {
  if (!list) return "";
  const arr = Array.isArray(list) ? list : [list];
  return arr.map((a) => (a.name && a.address ? `${a.name} <${a.address}>` : a.address || a.name || "")).filter(Boolean).join(", ");
}

export function htmlToPlain(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("style, script, head").forEach((n) => n.remove());
  doc.querySelectorAll("br").forEach((n) => n.replaceWith("\n"));
  doc.querySelectorAll("p, div, tr, li, h1, h2, h3, h4, blockquote").forEach((n) => n.append("\n"));
  return (doc.body?.textContent ?? "").replace(/ /g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export async function parseEml(file: File): Promise<EmlMessage> {
  const { default: PostalMime } = await import("postal-mime");
  const parsed = await PostalMime.parse(await file.arrayBuffer());
  const text = (parsed.text ?? "").trim() || (parsed.html ? htmlToPlain(parsed.html) : "");
  return {
    subject: parsed.subject ?? "",
    from: addr(parsed.from),
    to: addr(parsed.to),
    cc: addr(parsed.cc),
    date: parsed.date ?? "",
    text,
    attachments: (parsed.attachments ?? []).map((a) => ({ filename: a.filename || "(unnamed)", mimeType: a.mimeType, size: a.content ? (a.content as ArrayBuffer).byteLength ?? 0 : 0 })),
  };
}

/** The message as readable text, the way a person would paste it. */
export function emlToText(m: EmlMessage): string {
  const head = [`Subject: ${m.subject}`, `From: ${m.from}`, `To: ${m.to}`, m.cc ? `Cc: ${m.cc}` : "", `Date: ${m.date}`].filter(Boolean).join("\n");
  const att = m.attachments.length ? `\nAttachments: ${m.attachments.map((a) => `${a.filename} (${a.mimeType}, ${Math.round(a.size / 1024)} KB)`).join("; ")}` : "";
  return `${head}${att}\n\n${m.text}`.trim();
}
