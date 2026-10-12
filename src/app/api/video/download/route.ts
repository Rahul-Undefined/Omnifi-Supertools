import { NextResponse } from "next/server";
import { z } from "zod";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { videoDownload } from "@/lib/server/video";
import { currentUser, isSameOrigin } from "@/lib/server/auth";
import { store } from "@/lib/server/store";
import { rateLimit, clientKey } from "@/lib/server/ratelimit";
import { handleError, jsonError, readJson } from "@/lib/server/api";
import { mimeForExt } from "@/lib/files";

export const dynamic = "force-dynamic";
export const maxDuration = 900;

const schema = z.object({
  url: z.string().min(4).max(2048),
  quality: z.string().regex(/^(best|audio|\d{3,4}|format:[\w.+-]{1,40})$/).default("best"),
  container: z.enum(["mp4", "mkv", "webm", "mp3", "m4a", "wav"]).default("mp4"),
});

/** Downloads the video to a temp folder, streams it back, then deletes it. */
export async function POST(req: Request) {
  try {
    if (!isSameOrigin(req)) return jsonError("Cross-origin requests are not allowed", 403);
    const user = await currentUser();
    const rl = rateLimit(`videodl:${clientKey(req, user?.id)}`, 10);
    if (!rl.ok) return jsonError("Too many downloads. Slow down.", 429, `Try again in ${rl.retryAfter}s.`);
    const parsed = schema.safeParse(await readJson(req, 16 * 1024));
    if (!parsed.success) return jsonError("Invalid request", 400, parsed.error.issues[0]?.message);
    const started = Date.now();
    const file = await videoDownload(parsed.data, req.signal);
    await store().recordAudit({ at: Date.now(), actor: user?.id ?? "anonymous", action: "video.download", detail: `${new URL(parsed.data.url).hostname} ${parsed.data.quality} ${parsed.data.container} ${Math.round(file.bytes / 1e6)}MB ${Date.now() - started}ms` });
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    const stream = createReadStream(file.path);
    stream.on("close", () => { void file.cleanup(); });
    stream.on("error", () => { void file.cleanup(); });
    const ascii = file.name.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "'");
    return new NextResponse(Readable.toWeb(stream) as ReadableStream, {
      headers: {
        "content-type": mimeForExt(ext) || "application/octet-stream",
        "content-length": String(file.bytes),
        "content-disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.name)}`,
        "cache-control": "no-store",
        "x-file-name": encodeURIComponent(file.name),
      },
    });
  } catch (e) {
    return handleError(e);
  }
}
