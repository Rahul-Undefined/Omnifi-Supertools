import { NextResponse } from "next/server";
import { z } from "zod";
import { complete } from "@/lib/server/ai";
import { tasks } from "@/lib/server/ai-tasks";
import { env } from "@/lib/server/env";
import { currentUser, isSameOrigin } from "@/lib/server/auth";
import { store } from "@/lib/server/store";
import { rateLimit, clientKey } from "@/lib/server/ratelimit";
import { handleError, jsonError, readJson } from "@/lib/server/api";

const schema = z.object({
  task: z.string().refine((t) => t in tasks, "Unknown task"),
  input: z.string().max(1_000_000),
  options: z.record(z.string(), z.unknown()).default({}),
});

export async function POST(req: Request) {
  try {
    if (!isSameOrigin(req)) return jsonError("Cross-origin requests are not allowed", 403);
    const user = await currentUser();
    const rl = rateLimit(clientKey(req, user?.id), env.rateAi);
    if (!rl.ok) return NextResponse.json({ error: "Too many AI requests. Slow down.", hint: `Try again in ${rl.retryAfter}s.` }, { status: 429, headers: { "retry-after": String(rl.retryAfter) } });
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
    const started = Date.now();
    const result = await complete(spec.system, spec.build(input, options), { json: spec.json, maxTokens: spec.maxTokens });
    await store().recordAudit({ at: Date.now(), actor: user?.id ?? "anonymous", action: `ai.${task}`, detail: `${input.length} chars, ${Date.now() - started} ms` });
    return NextResponse.json({ ...result, text: truncated ? `${result.text}\n\n[Input was truncated to ${env.aiMaxInputChars.toLocaleString()} characters]` : result.text });
  } catch (e) {
    return handleError(e);
  }
}
