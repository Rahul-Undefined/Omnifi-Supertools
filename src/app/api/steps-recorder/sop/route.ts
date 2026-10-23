import { NextResponse } from "next/server";
import { z } from "zod";
import { AiError, completeWithImages, type ImageInput } from "@/lib/server/ai";
import { env } from "@/lib/server/env";
import { store } from "@/lib/server/store";
import { rateLimit, dailyQuota, consumeAllowance, refundAllowance } from "@/lib/server/ratelimit";
import { handleError, jsonError, readJson } from "@/lib/server/api";
import { stepsRecorderAuth, deviceAllowanceKey } from "../_shared";

/**
 * Steps Recorder desktop app -> AI-written SOP.
 *
 * The desktop app never holds an AI key. It sends the recorded steps plus downscaled screenshots here
 * with the app token (STEPS_RECORDER_TOKEN) and a per-install device id; this server holds the Gemini
 * key, enforces the per-device allowance (default 5 SOPs per 5 hours) and the team-wide free-tier pacing,
 * and returns the SOP as JSON. Screenshots are processed in memory only and never stored.
 */
export const maxDuration = 120;

const stepSchema = z.object({
  n: z.number().int().min(1).max(10_000),
  kind: z.enum(["click", "selection"]),
  button: z.enum(["left", "right", "middle"]),
  x: z.number().int(),
  y: z.number().int(),
  endX: z.number().int().optional(),
  endY: z.number().int().optional(),
  window: z.string().max(300).default(""),
  process: z.string().max(100).default(""),
  elementType: z.string().max(100).default(""),
  elementName: z.string().max(300).default(""),
  description: z.string().max(600).default(""),
});

const schema = z.object({
  recording: z.object({
    startedAt: z.string().max(40),
    durationSeconds: z.number().min(0).max(86_400),
    steps: z.array(stepSchema).min(1).max(400),
  }),
  // JPEG screenshots, base64, keyed by recorded step number. The app downsizes to 1280 px wide.
  images: z.array(z.object({ step: z.number().int().min(1), jpegBase64: z.string().max(1_600_000) })).max(60).default([]),
  language: z.string().max(40).default("English"),
});

const SYSTEM = [
  "You are a technical writer at Omnifi, a Finance-as-a-Service provider. You turn recorded user actions (clicks, drag selections and their screenshots) into a clear standard operating procedure (SOP) that a new colleague can follow without any other help.",
  "Write plain, direct English in active voice, sentence case and imperative mood (\"Click Save\", \"Select cells B2 to D10\").",
  "Describe WHAT the user did and WHY where it is obvious from the screen. Name the actual buttons, menus, fields, tabs and windows visible in the screenshots instead of coordinates.",
  "Keep the recorded order. Merge consecutive actions that belong to one logical step (for example opening a menu and choosing an item) into one instruction and list every merged recorded step number in sourceSteps.",
  "Ignore clicks that only switch focus or dismiss something irrelevant, but never skip an action that changes data.",
  "Never invent actions that are not in the recording. If something is unclear, describe what is visible.",
  "Never include passwords, account numbers or personal data you might see; write [redacted] instead.",
  "Answer ONLY with JSON of this exact shape: {\"title\": string, \"purpose\": string, \"prerequisites\": [string], \"steps\": [{\"sourceSteps\": [int], \"instruction\": string, \"detail\": string}], \"tips\": [string]}.",
].join("\n");

const sopSchema = z.object({
  title: z.string().min(1).max(200),
  purpose: z.string().max(2000).default(""),
  prerequisites: z.array(z.string().max(500)).max(30).default([]),
  steps: z.array(z.object({ sourceSteps: z.array(z.number().int()).default([]), instruction: z.string().min(1).max(1000), detail: z.string().max(3000).default("") })).min(1).max(400),
  tips: z.array(z.string().max(500)).max(30).default([]),
});

export async function POST(req: Request) {
  try {
    const auth = stepsRecorderAuth(req);
    if (!auth.ok) return jsonError(auth.error, auth.status);
    const deviceId = auth.deviceId;

    // Per-device burst limit, then the per-device allowance (default 5 SOPs per 5 hours).
    const rl = await rateLimit(`sr:${deviceId}`, 3);
    if (!rl.ok) return NextResponse.json({ error: "Too many requests from this computer", hint: `Try again in ${rl.retryAfter}s.` }, { status: 429, headers: { "retry-after": String(rl.retryAfter) } });

    const parsed = schema.safeParse(await readJson(req, 40 * 1024 * 1024));
    if (!parsed.success) return jsonError("Invalid request", 400, parsed.error.issues[0]?.message);
    const { recording, images, language } = parsed.data;

    const mine = await consumeAllowance(deviceAllowanceKey(deviceId), env.stepsRecorderQuota, env.stepsRecorderWindowHours);
    if (!mine.ok) {
      const mins = Math.max(1, Math.ceil((mine.resetsAt - Date.now()) / 60_000));
      return NextResponse.json({ error: "AI SOP allowance used up for now", hint: `${mine.limit} AI SOPs per ${mine.windowHours} hours per computer. Resets in ${mins >= 60 ? `${Math.floor(mins / 60)} h ${mins % 60} min` : `${mins} min`}.`, allowance: mine }, { status: 429, headers: { "retry-after": String(Math.ceil((mine.resetsAt - Date.now()) / 1000)) } });
    }
    const refund = () => refundAllowance(deviceAllowanceKey(deviceId), env.stepsRecorderWindowHours);

    // Team-wide pacing shared with the web tools keeps the whole company inside the provider's free tier.
    if (env.aiGlobalPerMin > 0 && !(await rateLimit("ai:global", env.aiGlobalPerMin)).ok) { await refund(); return NextResponse.json({ error: "The AI service is busy right now", hint: "Try again in a few seconds." }, { status: 429, headers: { "retry-after": "15" } }); }
    if (env.aiGlobalPerDay > 0) { const g = await dailyQuota("ai:global", env.aiGlobalPerDay); if (!g.ok) { await refund(); return NextResponse.json({ error: "Today's shared AI allowance is used up", hint: "Resets at midnight UTC." }, { status: 429, headers: { "retry-after": String(g.retryAfter) } }); } }

    // Build the prompt: step list + screenshots (at most STEPS_RECORDER_MAX_IMAGES, in step order).
    const lines: string[] = [];
    lines.push(`Recording made ${recording.startedAt}, duration ${Math.round(recording.durationSeconds)} seconds, ${recording.steps.length} recorded actions. Write the SOP in ${language}.`);
    lines.push("Recorded actions (each may be followed by its screenshot, which shows the screen at that moment with the click or selection highlighted):");
    const byStep = new Map(images.map((i) => [i.step, i.jpegBase64] as const));
    const imageParts: ImageInput[] = [];
    let imagesUsed = 0;
    for (const s of recording.steps) {
      const kind = s.kind === "selection" ? "SELECTION (drag)" : `${s.button.toUpperCase()} CLICK`;
      let line = `Step ${s.n}: ${kind} at (${s.x}, ${s.y})`;
      if (s.kind === "selection" && s.endX !== undefined && s.endY !== undefined) line += ` to (${s.endX}, ${s.endY})`;
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
    let result;
    try {
      result = await completeWithImages(SYSTEM, lines.join("\n"), imageParts, { json: true, maxTokens: 8192 });
    } catch (e) {
      await refund(); // provider failure is not the user's fault
      throw e;
    }

    let sop;
    try {
      sop = sopSchema.parse(JSON.parse(result.text));
    } catch {
      await refund();
      throw new AiError("The AI answer could not be read as an SOP", 502, "Try again; the model returned malformed JSON.");
    }

    await store().recordAudit({ at: Date.now(), actor: `steps-recorder:${deviceId.slice(0, 8)}`, action: "ai.steps-recorder-sop", detail: `${recording.steps.length} steps, ${imagesUsed} images, ${Date.now() - started} ms, ${result.model}` });
    return NextResponse.json({ sop, allowance: mine, imagesUsed });
  } catch (e) {
    return handleError(e);
  }
}
