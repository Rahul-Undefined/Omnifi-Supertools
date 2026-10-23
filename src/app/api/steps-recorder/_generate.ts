import "server-only";
import { z } from "zod";
import { AiError, completeWithImages, type ImageInput } from "@/lib/server/ai";
import { env } from "@/lib/server/env";
import { store } from "@/lib/server/store";

/** Request body shared by the synchronous and the asynchronous SOP endpoints. */
const stepSchema = z.object({
  n: z.number().int().min(1).max(10_000),
  kind: z.enum(["click", "selection"]),
  button: z.enum(["left", "right", "middle"]),
  x: z.number().int(),
  y: z.number().int(),
  endX: z.number().int().nullish(),
  endY: z.number().int().nullish(),
  window: z.string().max(300).default(""),
  process: z.string().max(100).default(""),
  elementType: z.string().max(100).default(""),
  elementName: z.string().max(300).default(""),
  description: z.string().max(600).default(""),
});

export const sopRequestSchema = z.object({
  recording: z.object({
    startedAt: z.string().max(40),
    durationSeconds: z.number().min(0).max(86_400),
    steps: z.array(stepSchema).min(1).max(400),
  }),
  // JPEG screenshots, base64, keyed by recorded step number. The app downsizes them before upload.
  images: z.array(z.object({ step: z.number().int().min(1), jpegBase64: z.string().max(1_600_000) })).max(60).default([]),
  language: z.string().max(40).default("English"),
});
export type SopRequest = z.infer<typeof sopRequestSchema>;

export const SYSTEM = [
  "You are a technical writer at Omnifi, a Finance-as-a-Service provider. You turn recorded user actions (clicks, drag selections and their screenshots) into a clear standard operating procedure (SOP) that a new colleague can follow without any other help.",
  "Write plain, direct English in active voice, sentence case and imperative mood (\"Click Save\", \"Select cells B2 to D10\").",
  "Describe WHAT the user did and WHY where it is obvious from the screen. Name the actual buttons, menus, fields, tabs and windows visible in the screenshots instead of coordinates.",
  "Keep the recorded order. Merge consecutive actions that belong to one logical step (for example opening a menu and choosing an item) into one instruction and list every merged recorded step number in sourceSteps.",
  "Ignore clicks that only switch focus or dismiss something irrelevant, but never skip an action that changes data.",
  "Never invent actions that are not in the recording. If something is unclear, describe what is visible.",
  "Never include passwords, account numbers or personal data you might see; write [redacted] instead.",
  "Be concise: one or two sentences per instruction and detail. Answer quickly without lengthy deliberation.",
  "Answer ONLY with JSON of this exact shape: {\"title\": string, \"purpose\": string, \"prerequisites\": [string], \"steps\": [{\"sourceSteps\": [int], \"instruction\": string, \"detail\": string}], \"tips\": [string]}.",
].join("\n");

export const sopSchema = z.object({
  title: z.string().min(1).max(200),
  purpose: z.string().max(2000).default(""),
  prerequisites: z.array(z.string().max(500)).max(30).default([]),
  steps: z.array(z.object({ sourceSteps: z.array(z.number().int()).default([]), instruction: z.string().min(1).max(1000), detail: z.string().max(3000).default("") })).min(1).max(400),
  tips: z.array(z.string().max(500)).max(30).default([]),
});
export type Sop = z.infer<typeof sopSchema>;

export interface SopOutcome { sop: Sop; imagesUsed: number; model: string; ms: number }

/** Builds the prompt from the recording and asks the provider. Throws AiError on provider/format problems. */
export async function generateSop(req: SopRequest, deviceId: string): Promise<SopOutcome> {
  const { recording, images, language } = req;
  const lines: string[] = [];
  lines.push(`Recording made ${recording.startedAt}, duration ${Math.round(recording.durationSeconds)} seconds, ${recording.steps.length} recorded actions. Write the SOP in ${language}.`);
  lines.push("Recorded actions (each may be followed by its screenshot, which shows the screen at that moment with the click or selection highlighted):");
  const byStep = new Map(images.map((i) => [i.step, i.jpegBase64] as const));
  const imageParts: ImageInput[] = [];
  let imagesUsed = 0;
  for (const s of recording.steps) {
    const kind = s.kind === "selection" ? "SELECTION (drag)" : `${s.button.toUpperCase()} CLICK`;
    let line = `Step ${s.n}: ${kind} at (${s.x}, ${s.y})`;
    if (s.kind === "selection" && s.endX != null && s.endY != null) line += ` to (${s.endX}, ${s.endY})`;
    if (s.window) line += ` in window "${s.window}"`;
    if (s.process) line += ` (${s.process}.exe)`;
    if (s.elementType || s.elementName) line += `; UI element: ${s.elementType}${s.elementName ? ` "${s.elementName}"` : ""}`;
    if (s.description) line += `; description: ${s.description}`;
    lines.push(line);
    const img = byStep.get(s.n);
    if (img && imagesUsed < env.stepsRecorderMaxImages) {
      imageParts.push({ label: `Screenshot for step ${s.n}:`, mimeType: "image/jpeg", base64: img });
      imagesUsed++;
    }
  }

  const started = Date.now();
  const result = await completeWithImages(SYSTEM, lines.join("\n"), imageParts, { json: true, maxTokens: 8192, model: env.stepsRecorderModel || undefined, fastThinking: true });
  let sop: Sop;
  try {
    sop = sopSchema.parse(JSON.parse(result.text));
  } catch {
    throw new AiError("The AI answer could not be read as an SOP", 502, "Try again; the model returned malformed JSON.");
  }
  const ms = Date.now() - started;
  await store().recordAudit({ at: Date.now(), actor: `steps-recorder:${deviceId.slice(0, 8)}`, action: "ai.steps-recorder-sop", detail: `${recording.steps.length} steps, ${imagesUsed} images, ${ms} ms, ${result.model}` });
  return { sop, imagesUsed, model: result.model, ms };
}
