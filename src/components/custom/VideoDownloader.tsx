"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CloudDownload, Search, AlertTriangle, Check, MonitorDown, Clock, Film, Music } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input, Label, Select } from "@/components/ui/Input";
import { downloadBlob } from "@/lib/files";
import { formatBytes } from "@/lib/utils";

interface Format { id: string; ext: string; resolution: string; height: number | null; fps: number | null; vcodec: string; acodec: string; filesize: number | null; note: string; tbr: number | null }
interface Info { title: string; uploader: string; duration: number | null; thumbnail: string | null; site: string; url: string; formats: Format[]; heights: number[] }
interface Status { available: boolean; version?: string; ffmpeg?: boolean; cookies?: boolean; proxy?: boolean; maxMb?: number; hint?: string }
interface Err { message: string; hint?: string }

const fmtDuration = (s: number | null) => (s == null ? "" : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`);

/** Paste a link, inspect what the site offers, pick quality and format, download through the server. */
export function VideoDownloader() {
  const [status, setStatus] = useState<Status | null>(null);
  const [url, setUrl] = useState("");
  const [info, setInfo] = useState<Info | null>(null);
  const [phase, setPhase] = useState<"idle" | "inspecting" | "downloading" | "done">("idle");
  const [error, setError] = useState<Err | null>(null);
  const [quality, setQuality] = useState("best");
  const [container, setContainer] = useState("mp4");
  const [mode, setMode] = useState<"video" | "audio">("video");
  const [showAll, setShowAll] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState<{ name: string; bytes: number } | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => { fetch("/api/video/status").then((r) => r.json()).then(setStatus).catch(() => setStatus({ available: false })); }, []);
  useEffect(() => {
    if (phase !== "downloading" && phase !== "inspecting") return;
    const t0 = Date.now();
    const id = setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(id);
  }, [phase]);

  const inspect = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const target = url.trim();
    if (!target) return;
    setError(null); setInfo(null); setResult(null); setPhase("inspecting"); setElapsed(0);
    try {
      const res = await fetch("/api/video/info", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: target }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError({ message: data.error ?? `Request failed (${res.status})`, hint: data.hint }); setPhase("idle"); return; }
      setInfo(data as Info);
      setQuality("best");
      setPhase("idle");
    } catch (err) {
      setError({ message: "Could not reach the server", hint: err instanceof Error ? err.message : undefined });
      setPhase("idle");
    }
  };

  const download = async () => {
    if (!info) return;
    setError(null); setResult(null); setPhase("downloading"); setElapsed(0);
    abort.current = new AbortController();
    try {
      const body = { url: info.url, quality: mode === "audio" ? "audio" : quality, container: mode === "audio" ? (["mp3", "m4a", "wav"].includes(container) ? container : "mp3") : (["mp4", "mkv", "webm"].includes(container) ? container : "mp4") };
      const res = await fetch("/api/video/download", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: abort.current.signal });
      if (!res.ok) { const data = await res.json().catch(() => ({})); setError({ message: data.error ?? `Download failed (${res.status})`, hint: data.hint }); setPhase("idle"); return; }
      const name = decodeURIComponent(res.headers.get("x-file-name") ?? "") || `${info.title}.${body.container}`;
      const blob = await res.blob();
      downloadBlob(blob, name);
      setResult({ name, bytes: blob.size });
      setPhase("done");
    } catch (err) {
      if ((err as Error)?.name === "AbortError") setError({ message: "Cancelled" });
      else setError({ message: "The download was interrupted", hint: err instanceof Error ? err.message : undefined });
      setPhase("idle");
    }
  };

  const videoContainers = ["mp4", "mkv", "webm"];
  const audioContainers = ["mp3", "m4a", "wav"];
  const busy = phase === "inspecting" || phase === "downloading";

  return (
    <div className="space-y-5">
      {status && !status.available && (
        <div className="rounded-control border border-warning/40 bg-warning-soft/40 p-4 text-sm text-body flex gap-3"><AlertTriangle className="h-5 w-5 shrink-0 text-warning" /><div><p className="font-medium text-foreground">The download engine is not available on this server.</p><p className="mt-1">{status.hint}</p></div></div>
      )}

      <form onSubmit={inspect} className="rounded-control border border-border bg-surface p-5">
        <Label htmlFor="video-url">Video link</Label>
        <div className="mt-1.5 flex flex-col gap-2 sm:flex-row">
          <Input id="video-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.youtube.com/watch?v=…  or any video page" autoComplete="off" spellCheck={false} disabled={busy} className="flex-1" />
          <Button type="submit" loading={phase === "inspecting"} disabled={!url.trim() || busy || status?.available === false}><Search className="h-4 w-4" /> Check link</Button>
        </div>
        <p className="mt-2 text-xs text-muted">Works with YouTube, Facebook, Instagram, X, TikTok, Vimeo, LinkedIn, Dailymotion, direct .mp4 links and hundreds more. Public videos only. Download content you have the rights to use.</p>
      </form>

      {error && (
        <div className="rounded-control border border-error/40 bg-error-soft/40 p-4 text-sm flex gap-3 animate-fade-up">
          <AlertTriangle className="h-5 w-5 shrink-0 text-error" />
          <div>
            <p className="font-medium text-foreground">{error.message}</p>
            {error.hint && <p className="mt-1 text-body">{error.hint}</p>}
            {/youtube|bot|rate-limit|429/i.test(error.message + (error.hint ?? "")) && (
              <p className="mt-2 text-body"><MonitorDown className="mr-1 inline h-4 w-4 text-accent" />The <Link href="/downloads" className="font-medium text-accent hover:underline">Windows helper</Link> downloads from your own PC, which YouTube does not block.</p>
            )}
          </div>
        </div>
      )}

      {info && (
        <div className="rounded-control border border-border bg-surface p-5 animate-fade-up">
          <div className="flex gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element -- remote thumbnail from the video site, not optimisable */}
            {info.thumbnail && <img src={info.thumbnail} alt="" className="h-20 w-32 shrink-0 rounded-control-sm object-cover bg-surface-2" referrerPolicy="no-referrer" />}
            <div className="min-w-0">
              <h2 className="font-semibold text-foreground line-clamp-2">{info.title}</h2>
              <p className="mt-1 text-sm text-muted">{[info.uploader, info.site, fmtDuration(info.duration)].filter(Boolean).join(" · ")}</p>
              <p className="mt-1 text-xs text-muted">{info.heights.length ? `Available up to ${info.heights[0]}p` : "Audio or single-quality stream"} · {info.formats.length} stream(s)</p>
            </div>
          </div>

          <div className="mt-5 grid gap-4 sm:grid-cols-3">
            <div>
              <Label htmlFor="v-mode">What to save</Label>
              <Select id="v-mode" value={mode} onChange={(e) => { const m = e.target.value as "video" | "audio"; setMode(m); setContainer(m === "audio" ? "mp3" : "mp4"); }} disabled={busy}>
                <option value="video">Video (with sound)</option>
                <option value="audio">Audio only</option>
              </Select>
            </div>
            {mode === "video" ? (
              <div>
                <Label htmlFor="v-quality">Quality</Label>
                <Select id="v-quality" value={quality} onChange={(e) => setQuality(e.target.value)} disabled={busy}>
                  <option value="best">Best available{info.heights[0] ? ` (${info.heights[0]}p)` : ""}</option>
                  {[2160, 1440, 1080, 720, 480, 360, 240].filter((h) => info.heights.some((x) => x <= h) && (!info.heights[0] || h <= info.heights[0])).map((h) => <option key={h} value={String(h)}>Up to {h}p{h >= 2160 ? " (4K)" : h === 1080 ? " (Full HD)" : h === 720 ? " (HD)" : ""}</option>)}
                  {showAll && info.formats.map((f) => <option key={f.id} value={`format:${f.id}`}>#{f.id} · {f.resolution} {f.fps ? `${f.fps}fps` : ""} · {f.ext} · {f.vcodec !== "none" ? f.vcodec.split(".")[0] : "no video"}/{f.acodec !== "none" ? f.acodec.split(".")[0] : "no audio"}{f.filesize ? ` · ${formatBytes(f.filesize)}` : ""}{f.note ? ` · ${f.note}` : ""}</option>)}
                </Select>
                <button type="button" onClick={() => setShowAll((s) => !s)} className="mt-1 text-xs text-accent hover:underline">{showAll ? "Hide individual streams" : "Show every individual stream"}</button>
              </div>
            ) : <div />}
            <div>
              <Label htmlFor="v-container">Format</Label>
              <Select id="v-container" value={container} onChange={(e) => setContainer(e.target.value)} disabled={busy}>
                {(mode === "audio" ? audioContainers : videoContainers).map((c) => <option key={c} value={c}>{c.toUpperCase()}{c === "mp4" ? " (plays everywhere)" : c === "mp3" ? " (plays everywhere)" : ""}</option>)}
              </Select>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Button onClick={download} loading={phase === "downloading"} disabled={busy}><CloudDownload className="h-4 w-4" /> Download {mode === "audio" ? container.toUpperCase() : `${quality === "best" ? "best" : quality.startsWith("format:") ? "stream" : quality + "p"} ${container.toUpperCase()}`}</Button>
            {phase === "downloading" && <Button variant="ghost" size="sm" onClick={() => abort.current?.abort()}>Cancel</Button>}
            {busy && <span className="inline-flex items-center gap-1.5 text-sm text-muted"><Clock className="h-4 w-4" /> {elapsed}s{phase === "downloading" ? " · fetching and merging on the server, then sending to you" : " · reading the page"}</span>}
          </div>
          {status?.maxMb && <p className="mt-2 text-xs text-muted">Limit {status.maxMb} MB per download. Long 4K videos may exceed it; pick 1080p or lower.</p>}
        </div>
      )}

      {result && phase === "done" && (
        <div className="rounded-control border border-success/40 bg-success-soft/40 p-4 text-sm flex items-center gap-3 animate-fade-up">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-success text-navy-800"><Check className="h-5 w-5" strokeWidth={3} /></span>
          <div><p className="font-medium text-foreground">Saved {result.name}</p><p className="text-muted">{formatBytes(result.bytes)} · check your browser downloads. The copy on the server was deleted.</p></div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 text-xs text-muted">
        <p className="rounded-control border border-border bg-surface p-3"><Film className="mr-1 inline h-3.5 w-3.5 text-accent" />1080p and above are usually separate video and audio streams; the server merges them with FFmpeg into your chosen format, which takes a little longer.</p>
        <p className="rounded-control border border-border bg-surface p-3"><Music className="mr-1 inline h-3.5 w-3.5 text-accent" />Audio only converts the best audio stream to MP3, M4A or WAV. For a video you already have, use Extract audio instead.</p>
      </div>
    </div>
  );
}
