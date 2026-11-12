import { describe, it, expect } from "vitest";
import { parseEml, emlToText } from "@/processors/shared/eml";

const SAMPLE = [
  "From: Priya Shah <priya@example.com>",
  "To: Rahul Ojha <rahul@myomnifi.com>",
  "Cc: Maya Chen <maya@example.com>",
  "Subject: RE: Q3 bank statements",
  "Date: Tue, 11 Nov 2026 09:15:00 +0530",
  "MIME-Version: 1.0",
  'Content-Type: multipart/mixed; boundary="b1"',
  "",
  "--b1",
  'Content-Type: multipart/alternative; boundary="b2"',
  "",
  "--b2",
  "Content-Type: text/plain; charset=utf-8",
  "Content-Transfer-Encoding: quoted-printable",
  "",
  "Hi Rahul, attached are the statements. Total fees were =E2=82=AC1,250.",
  "",
  "On Mon, 10 Nov 2026, Rahul Ojha wrote:",
  "> Could you send the Q3 statements by the 15th?",
  "--b2",
  "Content-Type: text/html; charset=utf-8",
  "",
  "<html><body><p>Hi Rahul, attached are the statements.</p></body></html>",
  "--b2--",
  "--b1",
  'Content-Type: application/pdf; name="statement-q3.pdf"',
  "Content-Transfer-Encoding: base64",
  'Content-Disposition: attachment; filename="statement-q3.pdf"',
  "",
  "JVBERi0xLjQKJeLjz9MK",
  "--b1--",
  "",
].join("\r\n");

describe("EML reader", () => {
  it("reads headers, the plain-text body with quoted reply, and attachments", async () => {
    const file = new File([SAMPLE], "thread.eml", { type: "message/rfc822" });
    const m = await parseEml(file);
    expect(m.subject).toBe("RE: Q3 bank statements");
    expect(m.from).toBe("Priya Shah <priya@example.com>");
    expect(m.to).toBe("Rahul Ojha <rahul@myomnifi.com>");
    expect(m.cc).toContain("maya@example.com");
    expect(m.text).toContain("€1,250"); // quoted-printable decoded
    expect(m.text).toContain("> Could you send the Q3 statements by the 15th?");
    expect(m.attachments).toEqual([{ filename: "statement-q3.pdf", mimeType: "application/pdf", size: 15 }]);
    const text = emlToText(m);
    expect(text.startsWith("Subject: RE: Q3 bank statements\nFrom: Priya Shah")).toBe(true);
    expect(text).toContain("Attachments: statement-q3.pdf (application/pdf, 0 KB)");
  });
});
