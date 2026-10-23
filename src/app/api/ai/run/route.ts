import { NextResponse } from "next/server";
import { z } from "zod";
import { complete, modelFor } from "@/lib/server/ai";
import { createHash } from "node:crypto";
import { tasks } from "@/lib/server/ai-tasks";
import { env } from "@/lib/server/env";
import { requireUser, isSameOrigin } from "@/lib/server/auth";
import { store } from "@/lib/server/store";
import { rateLimit, dailyQuota, clientKey, consumeAllowance, peekAllowance } from "@/lib/server/ratelimit";
import { handleError, jsonError, readJson } from "@/lib/server/api";

const schema = z.object({
  task: z.string().refine((t) => t in tasks, "Unknown task"),
  input: z.string().max(1_000_000),
  options: z.record(z.string(), z.unknown()).default({}),
});

export async function POST(req: Request) {
  try {
    if (!isSameOrigin(req)) return jsonError("Cross-origin requests are not allowed", 403);
    const user = await requireUser();
    const key = clientKey(req, user.id);
    const rl = await rateLimit(`ai:${key}`, env.rateAi);
    if (!rl.ok) return NextResponse.json({ error: "Too many AI requests. Slow down.", hint: `Try again in ${rl.retryAfter}s.` }, { status: 429, headers: { "retry-after": String(rl.retryAfter) } });
    const q = await dailyQuota(`ai:${key}`, env.quotaAiPerDay);
    if (!q.ok) return NextResponse.json({ error: "Daily AI quota reached", hint: `Up to ${env.quotaAiPerDay} AI requests per day. Resets at midnight UTC.` }, { status: 429, headers: { "retry-after": String(q.retryAfter) } });
    const parsed = schema.safeParse(await readJson(req, 2 * 1024 * 1024));
    if (!parsed.success) return jsonError("Invalid request", 400, parsed.error.issues[0]?.message);
    const { task, options } = parsed.data;
    let input = parsed.data.input;
    let truncated = false;
    if (input.length > env.aiMaxInputChars) {
      input = input.slice(0, env.aiMaxInputChars);
      truncated = true;
    }
    const spec = tasks[task];
    const cap = Math.min(env.aiMaxInputChars, spec.maxInputChars ?? env.aiMaxInputChars);
    if (input.length > cap) { input = input.slice(0, cap); truncated = true; }
    const started = Date.now();
    const prompt = spec.build(input, options);
    const model = modelFor(spec.tier);
    // Identical request -> cached answer, no provider call (free-tier friendly).
    const cacheKey = createHash("sha256").update(`${task}\n${model}\n${spec.system}\n${prompt}`).digest("hex");
    const cacheMs = env.aiCacheDays * 86_400_000;
    const cached = cacheMs > 0 ? await store().cacheGet(cacheKey, cacheMs) : null;
    const isAdmin = user.role === "admin";
    const present = (r: { text: string; model: string; usage?: { input: number; output: number } }, allowance: Awaited<ReturnType<typeof peekAllowance>>, cachedFlag: boolean) => ({
      text: truncated ? `${r.text}\n\n[Input was truncated to ${cap.toLocaleString()} characters]` : r.text,
      cached: cachedFlag,
      allowance,
      // Provider and model names are admin-only information.
      ...(isAdmin ? { model: r.model, usage: r.usage } : {}),
    });
    if (cached) {
      const r = JSON.parse(cached) as { text: string; model: string; usage?: { input: number; output: number } };
      await store().recordAudit({ at: Date.now(), actor: user.id, action: `ai.${task}`, detail: `cache hit, ${input.length} chars` });
      return NextResponse.json(present(r, await peekAllowance(user.id, env.aiUserQuota, env.aiUserWindowHours), true));
    }
    // Personal allowance (e.g. 15 requests per 3 hours), tied to the signed-in account.
    const mine = await consumeAllowance(user.id, env.aiUserQuota, env.aiUserWindowHours);
    if (!mine.ok) {
      const mins = Math.max(1, Math.ceil((mine.resetsAt - Date.now()) / 60_000));
      return NextResponse.json({ error: "You have used your AI allowance for now", hint: `${mine.limit} AI requests per ${mine.windowHours} hours per person. Yours resets in ${mins >= 60 ? `${Math.floor(mins / 60)} h ${mins % 60} min` : `${mins} min`}. Repeating an identical request is free.`, allowance: mine }, { status: 429, headers: { "retry-after": String(Math.ceil((mine.resetsAt - Date.now()) / 1000)) } });
    }
    // Server-wide pacing keeps the whole team under the provider's free-tier limits.
    if (env.aiGlobalPerMin > 0 && !(await rateLimit("ai:global", env.aiGlobalPerMin)).ok) return NextResponse.json({ error: "The AI tools are busy right now", hint: `The team shares ${env.aiGlobalPerMin} AI requests per minute on the free tier. Try again in a few seconds.` }, { status: 429, headers: { "retry-after": "15" } });
    if (env.aiGlobalPerDay > 0) { const g = await dailyQuota("ai:global", env.aiGlobalPerDay); if (!g.ok) return NextResponse.json({ error: "Today's shared AI allowance is used up", hint: `The free tier allows about ${env.aiGlobalPerDay} requests per day across the team. Resets at midnight UTC.` }, { status: 429, headers: { "retry-after": String(g.retryAfter) } }); }
    const result = await complete(spec.system, prompt, { json: spec.json, maxTokens: spec.maxTokens, tier: spec.tier });
    if (cacheMs > 0) await store().cacheSet(cacheKey, JSON.stringify(result));
    await store().recordAudit({ at: Date.now(), actor: user.id, action: `ai.${task}`, detail: `${input.length} chars, ${Date.now() - started} ms, ${result.model}` });
    return NextResponse.json(present(result, mine, false));
  } catch (e) {
    return handleError(e);
  }
}
