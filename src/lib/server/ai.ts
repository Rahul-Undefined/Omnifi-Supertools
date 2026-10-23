import "server-only";
import { env } from "./env";

/**
 * Provider-agnostic AI client. Providers are selected by AI_PROVIDER:
 *   anthropic           -> Anthropic Messages API (ANTHROPIC_API_KEY)
 *   openai              -> OpenAI Chat Completions (OPENAI_API_KEY)
 *   openai-compatible   -> any OpenAI-compatible endpoint (OPENAI_BASE_URL + OPENAI_API_KEY),
 *                          e.g. Azure OpenAI gateway, Ollama, vLLM on the intranet.
 *   gemini              -> Google Gemini API, generateContent (GEMINI_API_KEY)
 * Keys never leave this module.
 */
export interface AiResult {
  text: string;
  model: string;
  usage?: { input: number; output: number };
}

export function aiStatus(): { configured: boolean; provider?: string; model?: string; hint?: string } {
  const p = env.aiProvider;
  if (!p) return { configured: false, hint: "Set AI_PROVIDER to anthropic, gemini, openai or openai-compatible, plus the matching API key." };
  if (p === "gemini" && !env.geminiKey) return { configured: false, provider: p, hint: "GEMINI_API_KEY is missing." };
  if (p === "anthropic" && !env.anthropicKey) return { configured: false, provider: p, hint: "ANTHROPIC_API_KEY is missing." };
  if ((p === "openai" || p === "openai-compatible") && !env.openaiKey && p === "openai") return { configured: false, provider: p, hint: "OPENAI_API_KEY is missing." };
  return { configured: true, provider: p, model: defaultModel() };
}

/** AI_MODEL is honoured only when it belongs to the active provider's family, so a stale value cannot break every call. */
function matchesProvider(model: string): boolean {
  if (env.aiProvider === "gemini") return /^gemini/i.test(model);
  if (env.aiProvider === "anthropic") return /^claude/i.test(model);
  return true;
}

function defaultModel(): string {
  if (env.aiModel && matchesProvider(env.aiModel)) return env.aiModel;
  return env.aiProvider === "anthropic" ? "claude-sonnet-5" : env.aiProvider === "gemini" ? "gemini-3.8-flash" : "gpt-4o-mini";
}

/** Cheaper model for short tasks; falls back to the main model when none is configured. */
export function liteModel(): string {
  if (env.aiModelLite && matchesProvider(env.aiModelLite)) return env.aiModelLite;
  if (env.aiProvider === "gemini") return "gemini-3.5-flash-lite";
  if (env.aiProvider === "anthropic") return "claude-haiku-5-5";
  if (env.aiProvider === "openai") return "gpt-4o-mini";
  return defaultModel();
}

export function modelFor(tier: "lite" | "standard" | undefined): string {
  return tier === "lite" ? liteModel() : defaultModel();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class AiError extends Error {
  hint?: string;
  status: number;
  constructor(message: string, status = 502, hint?: string) {
    super(message);
    this.status = status;
    this.hint = hint;
  }
}

export async function complete(system: string, user: string, opts: { maxTokens?: number; json?: boolean; tier?: "lite" | "standard" } = {}): Promise<AiResult> {
  // One polite retry on provider rate limiting (free tiers are strict), then a clear message.
  try {
    return await completeOnce(system, user, opts);
  } catch (e) {
    if (e instanceof AiError && e.status === 429) {
      await sleep(2500);
      try { return await completeOnce(system, user, opts); }
      catch (e2) { if (e2 instanceof AiError && e2.status === 429) throw new AiError("The AI provider is busy (free-tier limit)", 429, "Wait a minute and try again. Identical requests are served from cache, so retrying the same text is free."); throw e2; }
    }
    throw e;
  }
}

async function completeOnce(system: string, user: string, opts: { maxTokens?: number; json?: boolean; tier?: "lite" | "standard" }): Promise<AiResult> {
  const status = aiStatus();
  if (!status.configured) throw new AiError("AI provider is not configured", 503, status.hint);
  const model = modelFor(opts.tier);
  const maxTokens = opts.maxTokens ?? 2048;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  try {
    if (env.aiProvider === "anthropic") {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": env.anthropicKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] }),
        signal: controller.signal,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new AiError(`Anthropic API error (${res.status})`, res.status === 429 ? 429 : 502, data?.error?.message);
      const text = (data.content ?? []).filter((c: { type: string }) => c.type === "text").map((c: { text: string }) => c.text).join("");
      return { text: opts.json ? extractJson(text) : text, model: data.model ?? model, usage: data.usage ? { input: data.usage.input_tokens, output: data.usage.output_tokens } : undefined };
    }
    if (env.aiProvider === "gemini") {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": env.geminiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: user }] }],
          generationConfig: { maxOutputTokens: maxTokens, temperature: 0.3, ...(opts.json ? { responseMimeType: "application/json" } : {}) },
        }),
        signal: controller.signal,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new AiError(`Gemini API error (${res.status})`, res.status === 429 ? 429 : 502, data?.error?.message);
      const cand = data.candidates?.[0];
      const text = (cand?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? "").join("");
      if (!text && cand?.finishReason && cand.finishReason !== "STOP") throw new AiError("Gemini returned no text", 502, `finishReason: ${cand.finishReason}`);
      if (!text && data.promptFeedback?.blockReason) throw new AiError("Gemini blocked the request", 400, `blockReason: ${data.promptFeedback.blockReason}`);
      return { text: opts.json ? extractJson(text) : text, model: data.modelVersion ?? model, usage: data.usageMetadata ? { input: data.usageMetadata.promptTokenCount ?? 0, output: data.usageMetadata.candidatesTokenCount ?? 0 } : undefined };
    }
    const base = env.aiProvider === "openai" ? "https://api.openai.com/v1" : env.openaiBaseUrl.replace(/\/$/, "");
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(env.openaiKey ? { authorization: `Bearer ${env.openaiKey}` } : {}) },
      body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: "system", content: system }, { role: "user", content: user }], ...(opts.json ? { response_format: { type: "json_object" } } : {}) }),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new AiError(`AI provider error (${res.status})`, res.status === 429 ? 429 : 502, data?.error?.message);
    const text = data.choices?.[0]?.message?.content ?? "";
    return { text: opts.json ? extractJson(text) : text, model: data.model ?? model, usage: data.usage ? { input: data.usage.prompt_tokens, output: data.usage.completion_tokens } : undefined };
  } catch (e) {
    if (e instanceof AiError) throw e;
    if (controller.signal.aborted) throw new AiError("The AI provider timed out", 504);
    throw new AiError("Could not reach the AI provider", 502, e instanceof Error ? e.message : undefined);
  } finally {
    clearTimeout(timer);
  }
}

/** Pull the first JSON object/array out of a response that may include prose or fences. */
function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced ? fenced[1] : text).trim();
  const start = candidate.search(/[{[]/);
  if (start < 0) return candidate;
  const slice = candidate.slice(start);
  try {
    return JSON.stringify(JSON.parse(slice), null, 2);
  } catch {
    return slice;
  }
}
