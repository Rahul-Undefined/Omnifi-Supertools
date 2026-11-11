import "server-only";
import { env } from "./env";

/**
 * Provider-agnostic AI client. Providers are selected by AI_PROVIDER:
 *   anthropic           -> Anthropic Messages API (ANTHROPIC_API_KEY)
 *   openai              -> OpenAI Chat Completions (OPENAI_API_KEY)
 *   openai-compatible   -> any OpenAI-compatible endpoint (OPENAI_BASE_URL + OPENAI_API_KEY),
 *                          e.g. Azure OpenAI gateway, Ollama, vLLM on the intranet.
 *   gemini              -> Google Gemini API, generateContent (GEMINI_API_KEY)
 *   grok                -> xAI Grok, OpenAI-compatible chat completions at https://api.x.ai/v1 (XAI_API_KEY, "xai-...")
 *   groq                -> Groq (groq.com), OpenAI-compatible chat completions at https://api.groq.com/openai/v1 (GROQ_API_KEY, "gsk_...")
 * Keys never leave this module.
 */
export interface AiResult {
  text: string;
  model: string;
  usage?: { input: number; output: number };
}

export type Provider = "" | "anthropic" | "openai" | "openai-compatible" | "gemini" | "grok" | "groq";

/**
 * Active provider. Groq (groq.com, keys "gsk_...") and xAI Grok (x.ai, keys "xai-...") are different companies with
 * different endpoints; a Groq key pasted under the xAI setting is routed to Groq instead of failing with 400.
 */
export function provider(): Provider {
  const p = env.aiProvider;
  if (p === "grok" && !env.xaiKey && env.groqKey) return "groq";
  if (p === "grok" && env.xaiKey.startsWith("gsk_")) return "groq";
  if (p === "groq" && !env.groqKey && env.xaiKey.startsWith("xai-")) return "grok";
  return p;
}

function groqKey(): string { return env.groqKey || (env.xaiKey.startsWith("gsk_") ? env.xaiKey : ""); }
function xaiKey(): string { return env.xaiKey && !env.xaiKey.startsWith("gsk_") ? env.xaiKey : ""; }

export function aiStatus(): { configured: boolean; provider?: string; model?: string; hint?: string } {
  const p = provider();
  if (!p) return { configured: false, hint: "Set AI_PROVIDER to groq, grok, anthropic, gemini, openai or openai-compatible, plus the matching API key." };
  if (p === "groq" && !groqKey()) return { configured: false, provider: p, hint: "GROQ_API_KEY is missing (keys from console.groq.com start with gsk_)." };
  if (p === "grok" && !xaiKey()) return { configured: false, provider: p, hint: "XAI_API_KEY is missing (keys from console.x.ai start with xai-)." };
  if (p === "gemini" && !env.geminiKey) return { configured: false, provider: p, hint: "GEMINI_API_KEY is missing." };
  if (p === "anthropic" && !env.anthropicKey) return { configured: false, provider: p, hint: "ANTHROPIC_API_KEY is missing." };
  if (p === "openai" && !env.openaiKey) return { configured: false, provider: p, hint: "OPENAI_API_KEY is missing." };
  return { configured: true, provider: p, model: defaultModel() };
}

/** AI_MODEL is honoured only when it belongs to the active provider's family, so a stale value cannot break every call. */
function matchesProvider(model: string): boolean {
  const p = provider();
  if (p === "gemini") return /^gemini/i.test(model);
  if (p === "grok") return /^grok/i.test(model);
  if (p === "anthropic") return /^claude/i.test(model);
  if (p === "groq") return !/^(gemini|grok|claude|gpt-4|gpt-5|o[134])/i.test(model);
  return true;
}

/** Defaults when AI_MODEL / AI_MODEL_LITE are not set (override in Render). */
const GROK_DEFAULT = "grok-4.3"; // xAI's cheapest current text model
const GROQ_DEFAULT = "openai/gpt-oss-120b"; // Groq production model, strong general quality
const GROQ_LITE = "openai/gpt-oss-20b"; // Groq production model, ~1000 tokens/s

function defaultModel(): string {
  if (env.aiModel && matchesProvider(env.aiModel)) return env.aiModel;
  const p = provider();
  return p === "anthropic" ? "claude-sonnet-5" : p === "gemini" ? "gemini-3.8-flash" : p === "grok" ? GROK_DEFAULT : p === "groq" ? GROQ_DEFAULT : "gpt-4o-mini";
}

/** Cheaper model for short tasks; falls back to the main model when none is configured. */
export function liteModel(): string {
  if (env.aiModelLite && matchesProvider(env.aiModelLite)) return env.aiModelLite;
  const p = provider();
  if (p === "gemini") return "gemini-3.5-flash-lite";
  if (p === "grok") return GROK_DEFAULT;
  if (p === "groq") return GROQ_LITE;
  if (p === "anthropic") return "claude-haiku-5-5";
  if (p === "openai") return "gpt-4o-mini";
  return defaultModel();
}

export function modelFor(tier: "lite" | "standard" | undefined): string {
  return tier === "lite" ? liteModel() : defaultModel();
}

/** Base URL, key and label for the OpenAI-compatible providers (openai, openai-compatible, grok, groq). */
function compat(): { base: string; key: string; label: string } {
  const p = provider();
  if (p === "groq") return { base: "https://api.groq.com/openai/v1", key: groqKey(), label: "Groq" };
  if (p === "grok") return { base: "https://api.x.ai/v1", key: xaiKey(), label: "xAI" };
  if (p === "openai") return { base: "https://api.openai.com/v1", key: env.openaiKey, label: "OpenAI" };
  return { base: env.openaiBaseUrl.replace(/\/$/, ""), key: env.openaiKey, label: "AI provider" };
}

/**
 * Largest input (characters) a single request may carry on the active provider. Groq's free/developer tier allows
 * 8,000 tokens per minute per model, so one request must stay well under that (~4 chars per token); longer inputs
 * are truncated with a note rather than failing with 429/413.
 */
export function providerInputCap(): number {
  return provider() === "groq" ? 22_000 : Number.MAX_SAFE_INTEGER;
}

export interface ProviderLimit {
  model: string;
  at: number;
  /** Requests allowed / remaining in the provider's request window (Groq: per day). */
  requestsLimit?: number; requestsRemaining?: number; requestsReset?: string;
  /** Tokens allowed / remaining in the provider's token window (Groq: per minute). */
  tokensLimit?: number; tokensRemaining?: number; tokensReset?: string;
}
const limitsSeen = new Map<string, ProviderLimit>();

/** Remember the rate-limit headers the provider sent with its last response, per model (in memory, admin page only). */
function noteLimits(res: Response, model: string) {
  const h = res.headers;
  const num = (k: string) => { const v = h.get(k); return v == null || v === "" || Number.isNaN(Number(v)) ? undefined : Number(v); };
  const str = (k: string) => h.get(k) ?? undefined;
  if (!h.get("x-ratelimit-limit-requests") && !h.get("x-ratelimit-limit-tokens")) return;
  limitsSeen.set(model, {
    model, at: Date.now(),
    requestsLimit: num("x-ratelimit-limit-requests"), requestsRemaining: num("x-ratelimit-remaining-requests"), requestsReset: str("x-ratelimit-reset-requests"),
    tokensLimit: num("x-ratelimit-limit-tokens"), tokensRemaining: num("x-ratelimit-remaining-tokens"), tokensReset: str("x-ratelimit-reset-tokens"),
  });
}

/** Last known provider limits per model since the server started. */
export function providerLimits(): ProviderLimit[] { return [...limitsSeen.values()].sort((a, b) => b.at - a.at); }

/** Key of the active provider, for the admin fingerprint only (never returned in full). */
export function activeKey(): string {
  const p = provider();
  return p === "groq" ? groqKey() : p === "grok" ? xaiKey() : p === "gemini" ? env.geminiKey : p === "anthropic" ? env.anthropicKey : env.openaiKey;
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
    if (provider() === "anthropic") {
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
    if (provider() === "gemini") {
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
    const { base, key, label } = compat();
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: "system", content: system }, { role: "user", content: user }], ...(opts.json ? { response_format: { type: "json_object" } } : {}) }),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new AiError(`${label} API error (${res.status})`, res.status === 429 ? 429 : 502, typeof data?.error === "string" ? data.error : data?.error?.message);
    noteLimits(res, model);
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

export interface ImageInput { label: string; mimeType: "image/jpeg" | "image/png"; base64: string }

/**
 * Multimodal completion (text + images), used by the Steps Recorder SOP endpoint. Images are passed through to the
 * provider in memory and never stored. Same retry/pacing behaviour as `complete`.
 */
export interface MultimodalOptions {
  maxTokens?: number;
  json?: boolean;
  /** Override the provider model for this call (e.g. STEPS_RECORDER_MODEL); must belong to the active provider. */
  model?: string;
  /** Ask Gemini for minimal "thinking" so long multimodal requests answer faster (falls back silently if unsupported). */
  fastThinking?: boolean;
}

export async function completeWithImages(system: string, user: string, images: ImageInput[], opts: MultimodalOptions = {}): Promise<AiResult> {
  try {
    return await completeWithImagesOnce(system, user, images, opts);
  } catch (e) {
    if (e instanceof AiError && e.status === 429) {
      await sleep(2500);
      try { return await completeWithImagesOnce(system, user, images, opts); }
      catch (e2) { if (e2 instanceof AiError && e2.status === 429) throw new AiError("The AI provider is busy (free-tier limit)", 429, "Wait a minute and try again."); throw e2; }
    }
    throw e;
  }
}

async function completeWithImagesOnce(system: string, user: string, images: ImageInput[], opts: MultimodalOptions): Promise<AiResult> {
  const status = aiStatus();
  if (!status.configured) throw new AiError("AI provider is not configured", 503, status.hint);
  const model = opts.model && matchesProvider(opts.model) ? opts.model : provider() === "groq" && images.length ? env.groqVisionModel : defaultModel();
  const maxTokens = opts.maxTokens ?? 4096;
  const controller = new AbortController();
  // Multimodal SOP requests with dozens of screenshots take a while on the free tier; allow up to 4 minutes.
  const timer = setTimeout(() => controller.abort(), 240_000);
  try {
    if (provider() === "gemini") {
      const parts: Array<Record<string, unknown>> = [{ text: user }];
      for (const img of images) { parts.push({ text: img.label }); parts.push({ inline_data: { mime_type: img.mimeType, data: img.base64 } }); }
      const call = async (thinking: Record<string, unknown> | null) => {
        const generationConfig: Record<string, unknown> = { maxOutputTokens: maxTokens, temperature: 0.3, ...(opts.json ? { responseMimeType: "application/json" } : {}), ...(thinking ? { thinkingConfig: thinking } : {}) };
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": env.geminiKey },
          body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: "user", parts }], generationConfig }),
          signal: controller.signal,
        });
        const data = await res.json().catch(() => ({}));
        return { res, data };
      };
      // Low thinking first (Gemini 3.x: thinkingLevel; 2.5: thinkingBudget). If the model rejects the field, retry plainly.
      let { res, data } = opts.fastThinking ? await call({ thinkingLevel: "low" }) : await call(null);
      if (opts.fastThinking && res.status === 400 && /thinking/i.test(String(data?.error?.message ?? ""))) ({ res, data } = await call({ thinkingBudget: 0 }));
      if (opts.fastThinking && res.status === 400 && /thinking/i.test(String(data?.error?.message ?? ""))) ({ res, data } = await call(null));
      if (!res.ok) throw new AiError(`Gemini API error (${res.status})`, res.status === 429 ? 429 : 502, data?.error?.message);
      const cand = data.candidates?.[0];
      const text = (cand?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? "").join("");
      if (!text && data.promptFeedback?.blockReason) throw new AiError("Gemini blocked the request", 400, `blockReason: ${data.promptFeedback.blockReason}`);
      if (!text) throw new AiError("Gemini returned no text", 502, cand?.finishReason ? `finishReason: ${cand.finishReason}` : undefined);
      return { text: opts.json ? extractJson(text) : text, model: data.modelVersion ?? model, usage: data.usageMetadata ? { input: data.usageMetadata.promptTokenCount ?? 0, output: data.usageMetadata.candidatesTokenCount ?? 0 } : undefined };
    }
    if (provider() === "anthropic") {
      const content: Array<Record<string, unknown>> = [{ type: "text", text: user }];
      for (const img of images) { content.push({ type: "text", text: img.label }); content.push({ type: "image", source: { type: "base64", media_type: img.mimeType, data: img.base64 } }); }
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": env.anthropicKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: "user", content }] }),
        signal: controller.signal,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new AiError(`Anthropic API error (${res.status})`, res.status === 429 ? 429 : 502, data?.error?.message);
      const text = (data.content ?? []).filter((c: { type: string }) => c.type === "text").map((c: { text: string }) => c.text).join("");
      return { text: opts.json ? extractJson(text) : text, model: data.model ?? model, usage: data.usage ? { input: data.usage.input_tokens, output: data.usage.output_tokens } : undefined };
    }
    // OpenAI / compatible: image_url with data URIs.
    const content: Array<Record<string, unknown>> = [{ type: "text", text: user }];
    for (const img of images) { content.push({ type: "text", text: img.label }); content.push({ type: "image_url", image_url: { url: `data:${img.mimeType};base64,${img.base64}`, detail: "low" } }); }
    const { base, key, label } = compat();
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: "system", content: system }, { role: "user", content }], ...(opts.json ? { response_format: { type: "json_object" } } : {}) }),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new AiError(`${label} API error (${res.status})`, res.status === 429 ? 429 : 502, typeof data?.error === "string" ? data.error : data?.error?.message);
    noteLimits(res, model);
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
