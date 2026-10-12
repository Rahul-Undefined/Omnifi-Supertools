import "server-only";
import { NextResponse } from "next/server";
import { AuthError } from "./auth";
import { SsrfError } from "./ssrf";
import { AiError } from "./ai";

export function jsonError(message: string, status = 400, hint?: string) {
  return NextResponse.json({ error: message, hint }, { status });
}

/** Map known error classes to HTTP responses without leaking internals. */
export function handleError(e: unknown) {
  if (e instanceof AuthError) return jsonError(e.message, e.status);
  if (e instanceof SsrfError) return jsonError(e.message, 400, e.hint);
  if (e instanceof AiError) return jsonError(e.message, e.status, e.hint);
  console.error(e);
  return jsonError("Something went wrong. Try again.", 500);
}

export async function readJson<T>(req: Request, maxBytes = 2 * 1024 * 1024): Promise<T> {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > maxBytes) throw new SsrfError("Request body is too large");
  const text = await req.text();
  if (text.length > maxBytes) throw new SsrfError("Request body is too large");
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new SsrfError("Invalid JSON body");
  }
}
