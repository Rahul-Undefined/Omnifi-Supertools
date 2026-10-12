import "server-only";
import { spawn, execFile } from "node:child_process";
import { mkdtemp, readdir, rm, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { env } from "./env";
import { parseTarget, assertPublicHost, SsrfError } from "./ssrf";

/**
 * Video downloader backed by yt-dlp (installed in the Docker image) and FFmpeg.
 * Files are written to a per-request temp folder and deleted as soon as the
 * response has been streamed. Nothing is kept.
 */

export class VideoError extends Error {
  status: number;
  hint?: string;
  constructor(message: string, status = 400, hint?: string) {
    super(message);
    this.name = "VideoError";
    this.status = status;
    this.hint = hint;
  }
}

export interface VideoFormat {
  id: string;
  ext: string;
  resolution: string;
  height: number | null;
  fps: number | null;
  vcodec: string;
  acodec: string;
  filesize: number | null;
  note: string;
  tbr: number | null;
}

export interface VideoInfo {
  title: string;
  uploader: string;
  duration: number | null;
  thumbnail: string | null;
  site: string;
  url: string;
  formats: VideoFormat[];
  heights: number[];
}

export interface DownloadRequest {
  url: string;
  /** "best" | "<height>" | "audio" | "format:<id>" */
  quality: string;
  /** mp4 | mkv | webm (video) or mp3 | m4a | wav (audio) */
  container: string;
}

let capability: Promise<{ ok: boolean; version: string; flags: Set<string>; ffmpeg: boolean }> | null = null;

function run(cmd: string, args: string[], timeoutMs = 20000): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024, env: cleanEnv() }, (error, stdout, stderr) => {
      const code = error && typeof (error as { code?: unknown }).code === "number" ? Number((error as { code: number }).code) : error ? 1 : 0;
      resolve({ code, out: String(stdout ?? ""), err: String(stderr ?? "") + (error && !stderr ? String(error.message) : "") });
    });
  });
}

function cleanEnv() {
  return { ...process.env, XDG_CACHE_HOME: tmpdir(), HOME: process.env.HOME ?? tmpdir() };
}

/** Detect the engine once: version, supported flags, FFmpeg presence. */
export function engine() {
  if (!capability) {
    capability = (async () => {
      const v = await run(env.ytdlpBin, ["--version"]);
      if (v.code !== 0) return { ok: false, version: "", flags: new Set<string>(), ffmpeg: false };
      const help = await run(env.ytdlpBin, ["--help"]);
      const flags = new Set<string>();
      for (const f of ["--js-runtimes", "--remote-components", "--extractor-args", "--max-filesize", "--windows-filenames", "--no-cache-dir"]) if (help.out.includes(f)) flags.add(f);
      const ff = await run(env.ffmpegBin, ["-version"]);
      return { ok: true, version: v.out.trim(), flags, ffmpeg: ff.code === 0 };
    })();
  }
  return capability;
}

function baseArgs(flags: Set<string>): string[] {
  const args = ["--no-playlist", "--no-warnings", "--no-progress", "--no-color", "--ignore-config", "--no-call-home", "--socket-timeout", "20", "--retries", "3"];
  if (flags.has("--no-cache-dir")) args.push("--no-cache-dir");
  // Newer yt-dlp solves YouTube's JS challenges with a JS runtime; Node is always present in the image.
  if (flags.has("--js-runtimes")) args.push("--js-runtimes", "node");
  if (flags.has("--remote-components")) args.push("--remote-components", "ejs:github");
  if (env.ytdlpProxy) args.push("--proxy", env.ytdlpProxy);
  if (env.ytdlpExtraArgs) args.push(...env.ytdlpExtraArgs.split(/\s+/).filter(Boolean));
  return args;
}

async function cookiesFile(dir: string): Promise<string[]> {
  if (!env.ytdlpCookies) return [];
  const p = path.join(dir, "cookies.txt");
  await writeFile(p, env.ytdlpCookies.replace(/\\n/g, "\n"), { mode: 0o600 });
  return ["--cookies", p];
}

async function checkUrl(input: string): Promise<string> {
  const u = parseTarget(input.trim());
  await assertPublicHost(u.hostname);
  return u.href;
}

/** Translate yt-dlp's stderr into something a person can act on. */
export function explainError(stderr: string): { message: string; hint?: string } {
  const s = stderr.toLowerCase();
  if (s.includes("sign in to confirm") || s.includes("not a bot") || s.includes("confirm you’re not a bot")) return { message: "YouTube blocked this server (\"sign in to confirm you're not a bot\")", hint: "YouTube rate-limits cloud IP addresses. Use the Windows helper from the Downloads page, which downloads from your own PC, or ask the admin to set YTDLP_COOKIES in Render." };
  if (s.includes("private video") || s.includes("login required") || s.includes("members-only") || s.includes("this video is private")) return { message: "This video is private or needs a signed-in account", hint: "Only public videos can be downloaded here." };
  if (s.includes("unsupported url") || s.includes("no video formats") || s.includes("unable to extract")) return { message: "No downloadable video was found at this address", hint: "Paste the link of the video page itself (not a channel, search page or embedded player)." };
  if (s.includes("video unavailable") || s.includes("has been removed") || s.includes("404")) return { message: "The video is unavailable or has been removed" };
  if (s.includes("age") && s.includes("restricted")) return { message: "This video is age-restricted and needs a signed-in account" };
  if (s.includes("max-filesize") || s.includes("file is larger than")) return { message: `The file is larger than the ${env.videoMaxMb} MB limit`, hint: "Pick a lower quality or audio only." };
  if (s.includes("geo") && s.includes("restrict")) return { message: "The video is not available from this server's country" };
  if (s.includes("timed out") || s.includes("timeout")) return { message: "The site did not respond in time", hint: "Try again in a minute." };
  if (s.includes("http error 429")) return { message: "The site is rate-limiting this server (HTTP 429)", hint: "Wait a few minutes, or use the Windows helper." };
  const line = stderr.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.startsWith("ERROR")).pop() ?? stderr.trim().split(/\r?\n/).pop() ?? "";
  return { message: "The downloader reported an error", hint: line.replace(/^ERROR:\s*/, "").slice(0, 300) || undefined };
}

export async function videoInfo(input: string): Promise<VideoInfo> {
  const cap = await engine();
  if (!cap.ok) throw new VideoError("The video engine is not installed on this server", 503, "yt-dlp is part of the Docker image; local development machines need `pip install yt-dlp` and FFmpeg on the PATH.");
  const url = await checkUrl(input);
  const dir = await mkdtemp(path.join(tmpdir(), "omnifi-video-"));
  try {
    const args = [...baseArgs(cap.flags), ...(await cookiesFile(dir)), "--dump-single-json", "--skip-download", url];
    const r = await run(env.ytdlpBin, args, 90_000);
    if (r.code !== 0) { const e = explainError(r.err); throw new VideoError(e.message, 400, e.hint); }
    let j: Record<string, unknown>;
    try { j = JSON.parse(r.out); } catch { throw new VideoError("Could not read the video details"); }
    const rawFormats = Array.isArray(j.formats) ? (j.formats as Record<string, unknown>[]) : [];
    const formats: VideoFormat[] = rawFormats
      .filter((f) => f.format_id && (f.vcodec !== "none" || f.acodec !== "none"))
      .map((f) => ({
        id: String(f.format_id),
        ext: String(f.ext ?? ""),
        resolution: String(f.resolution ?? (f.height ? `${f.width ?? "?"}x${f.height}` : "audio only")),
        height: typeof f.height === "number" ? f.height : null,
        fps: typeof f.fps === "number" ? Math.round(f.fps) : null,
        vcodec: String(f.vcodec ?? "none"),
        acodec: String(f.acodec ?? "none"),
        filesize: typeof f.filesize === "number" ? f.filesize : typeof f.filesize_approx === "number" ? f.filesize_approx : null,
        note: String(f.format_note ?? ""),
        tbr: typeof f.tbr === "number" ? Math.round(f.tbr) : null,
      }))
      .filter((f) => !/^(mhtml|storyboard)/.test(f.ext) && !f.note.toLowerCase().includes("storyboard"));
    const heights = [...new Set(formats.map((f) => f.height).filter((h): h is number => !!h))].sort((a, b) => b - a);
    return {
      title: String(j.title ?? "video"),
      uploader: String(j.uploader ?? j.channel ?? j.uploader_id ?? ""),
      duration: typeof j.duration === "number" ? j.duration : null,
      thumbnail: typeof j.thumbnail === "string" ? j.thumbnail : null,
      site: String(j.extractor_key ?? j.extractor ?? new URL(url).hostname),
      url,
      formats,
      heights,
    };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

const VIDEO_CONTAINERS = new Set(["mp4", "mkv", "webm"]);
const AUDIO_CONTAINERS = new Set(["mp3", "m4a", "wav", "opus", "flac"]);
let active = 0;

export async function videoDownload(req: DownloadRequest, signal?: AbortSignal): Promise<{ path: string; name: string; bytes: number; cleanup: () => Promise<void> }> {
  const cap = await engine();
  if (!cap.ok) throw new VideoError("The video engine is not installed on this server", 503);
  if (active >= env.videoConcurrency) throw new VideoError("The downloader is busy with other requests", 429, "Try again in a minute.");
  const url = await checkUrl(req.url);
  const dir = await mkdtemp(path.join(tmpdir(), "omnifi-video-"));
  const cleanup = () => rm(dir, { recursive: true, force: true }).catch(() => {});
  active++;
  try {
    const args = [...baseArgs(cap.flags), ...(await cookiesFile(dir))];
    if (cap.flags.has("--max-filesize")) args.push("--max-filesize", `${env.videoMaxMb}M`);
    if (cap.flags.has("--windows-filenames")) args.push("--windows-filenames");
    args.push("-o", path.join(dir, "%(title).120B.%(ext)s"));
    const audio = req.quality === "audio" || AUDIO_CONTAINERS.has(req.container);
    if (audio) {
      const fmt = AUDIO_CONTAINERS.has(req.container) ? req.container : "mp3";
      args.push("-f", "ba/b");
      if (cap.ffmpeg) args.push("-x", "--audio-format", fmt, "--audio-quality", "0");
    } else {
      const container = VIDEO_CONTAINERS.has(req.container) ? req.container : "mp4";
      if (req.quality.startsWith("format:")) {
        const id = req.quality.slice(7);
        if (!/^[\w.+-]{1,40}$/.test(id)) throw new VideoError("Invalid format id");
        args.push("-f", cap.ffmpeg ? `${id}+ba/${id}` : id);
      } else if (/^\d{3,4}$/.test(req.quality)) {
        const h = Number(req.quality);
        args.push("-f", cap.ffmpeg ? `bv*[height<=${h}]+ba/b[height<=${h}]/b` : `b[height<=${h}]/b`);
      } else {
        args.push("-f", cap.ffmpeg ? "bv*+ba/b" : "b");
      }
      if (cap.ffmpeg) args.push("--merge-output-format", container);
      if (container === "mp4") args.push("-S", "res,ext:mp4:m4a");
    }
    args.push(url);

    await new Promise<void>((resolve, reject) => {
      const child = spawn(env.ytdlpBin, args, { env: cleanEnv(), stdio: ["ignore", "pipe", "pipe"] });
      let err = "";
      child.stderr.on("data", (d) => { err += String(d); if (err.length > 64_000) err = err.slice(-32_000); });
      child.stdout.on("data", () => {});
      const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new VideoError("The download took longer than the limit", 504, `Limit is ${Math.round(env.videoTimeoutMs / 60000)} minutes. Pick a lower quality.`)); }, env.videoTimeoutMs);
      const onAbort = () => { child.kill("SIGKILL"); clearTimeout(timer); reject(new VideoError("Cancelled", 499)); };
      signal?.addEventListener("abort", onAbort, { once: true });
      child.on("error", (e) => { clearTimeout(timer); reject(new VideoError("Could not start the downloader", 500, e.message)); });
      child.on("close", (code) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        if (code === 0) resolve();
        else { const e = explainError(err); reject(new VideoError(e.message, 400, e.hint)); }
      });
    });

    const files = (await readdir(dir)).filter((f) => f !== "cookies.txt" && !f.endsWith(".part") && !f.endsWith(".ytdl"));
    if (!files.length) throw new VideoError("The downloader finished but produced no file", 500, "This usually means the file exceeded the size limit.");
    // If several remain (rare: merge failed), take the largest.
    let best = files[0]; let bestSize = 0;
    for (const f of files) { const s = await stat(path.join(dir, f)); if (s.size > bestSize) { best = f; bestSize = s.size; } }
    return { path: path.join(dir, best), name: best, bytes: bestSize, cleanup };
  } catch (e) {
    await cleanup();
    if (e instanceof VideoError || e instanceof SsrfError) throw e;
    throw new VideoError("Download failed", 500, e instanceof Error ? e.message : undefined);
  } finally {
    active--;
  }
}
