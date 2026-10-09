import type { FileProcessor, ProcessorFile } from "@/types/processor";
import { ProcessorError, throwIfAborted } from "@/types/processor";
import { baseName, formatBytes } from "@/lib/utils";
import { getFFmpeg, runFFmpeg, safeInputName } from "./ffmpeg";
import { sizeStats, jsonOutput, fileFromBlob } from "../shared/output";
import { zipFiles } from "../shared/zip";
import { canvasToBlob, ctx2d, makeCanvas } from "../shared/canvas";

const MIME: Record<string, string> = {
  mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", mkv: "video/x-matroska", gif: "image/gif",
  mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", ogg: "audio/ogg", flac: "audio/flac",
};

function parseTime(s: string): number {
  const t = String(s ?? "").trim();
  if (!t) return 0;
  const parts = t.split(":").map(Number);
  if (parts.some((n) => isNaN(n))) throw new ProcessorError(`Invalid time "${t}"`, "Use hh:mm:ss or seconds");
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

function toFile(name: string, bytes: Uint8Array, ext: string): ProcessorFile {
  const blob = new Blob([bytes as BlobPart], { type: MIME[ext] ?? "application/octet-stream" });
  return { name, blob, bytes: blob.size, mime: blob.type };
}

async function perFile(
  files: File[],
  onProgress: ((f: number, l?: string) => void) | undefined,
  signal: AbortSignal | undefined,
  fn: (file: File, report: (f: number) => void) => Promise<ProcessorFile>,
) {
  const out: ProcessorFile[] = [];
  let original = 0;
  let output = 0;
  for (let i = 0; i < files.length; i++) {
    throwIfAborted(signal);
    const r = await fn(files[i], (f) => onProgress?.((i + f) / files.length, files[i].name));
    original += files[i].size;
    output += r.bytes;
    out.push(r);
  }
  return { files: out, stats: sizeStats(original, output) };
}

const videoArgs = (fmt: string, crf: number, scaleH = 0): string[] => {
  const vf = scaleH > 0 ? ["-vf", `scale=-2:'min(${scaleH},ih)'`] : [];
  if (fmt === "webm") return [...vf, "-c:v", "libvpx-vp9", "-crf", String(crf), "-b:v", "0", "-c:a", "libopus"];
  return [...vf, "-c:v", "libx264", "-preset", "veryfast", "-crf", String(crf), "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-c:a", "aac", "-b:a", "128k"];
};

export const convertVideo: FileProcessor = async (files, { options, onProgress, signal }) => {
  const fmt = String(options.format ?? "mp4");
  const crf = Number(options.crf ?? 28);
  return perFile(files, onProgress, signal, async (file, report) => {
    const out = `${baseName(file.name)}.${fmt}`;
    return toFile(out, await runFFmpeg(file, out, videoArgs(fmt, crf), report, signal), fmt);
  });
};

export const compressVideo: FileProcessor = async (files, { options, onProgress, signal }) => {
  const crf = Number(options.crf ?? 30);
  const scaleH = Number(options.scale ?? 720);
  return perFile(files, onProgress, signal, async (file, report) => {
    const out = `${baseName(file.name)}-compressed.mp4`;
    return toFile(out, await runFFmpeg(file, out, videoArgs("mp4", crf, scaleH), report, signal), "mp4");
  });
};

export const trim: FileProcessor = async (files, { options, onProgress, signal }) => {
  const start = parseTime(String(options.start ?? "0"));
  const end = parseTime(String(options.end ?? "10"));
  if (end <= start) throw new ProcessorError("End must be after start");
  const reencode = Boolean(options.reencode);
  return perFile(files, onProgress, signal, async (file, report) => {
    const out = `${baseName(file.name)}-trimmed.mp4`;
    const args = reencode ? videoArgs("mp4", 23) : ["-c", "copy"];
    return toFile(out, await runFFmpeg(file, out, ["-ss", String(start), "-to", String(end), ...args], report, signal), "mp4");
  });
};

export const mergeVideo: FileProcessor = async (files, { onProgress, signal }) => {
  if (files.length < 2) throw new ProcessorError("Add at least two clips");
  const ff = await getFFmpeg(onProgress);
  const names: string[] = [];
  for (let i = 0; i < files.length; i++) {
    const n = `in${i}.${safeInputName(files[i].name).split(".").pop()}`;
    await ff.writeFile(n, new Uint8Array(await files[i].arrayBuffer()));
    names.push(n);
  }
  // Normalise each clip to the same codec/size, then concat.
  const inter: string[] = [];
  for (let i = 0; i < names.length; i++) {
    throwIfAborted(signal);
    const o = `norm${i}.ts`;
    await ff.exec(["-i", names[i], "-vf", "scale=1280:-2", "-r", "30", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-c:a", "aac", "-ar", "44100", "-f", "mpegts", o]);
    inter.push(o);
    onProgress?.((i + 1) / (names.length + 1), `Normalising ${files[i].name}`);
  }
  await ff.exec(["-i", `concat:${inter.join("|")}`, "-c", "copy", "-bsf:a", "aac_adtstoasc", "-movflags", "+faststart", "merged.mp4"]);
  const data = await ff.readFile("merged.mp4");
  for (const n of [...names, ...inter, "merged.mp4"]) await ff.deleteFile(n).catch(() => {});
  if (typeof data === "string") throw new ProcessorError("Unexpected FFmpeg output");
  const file = toFile("merged.mp4", data, "mp4");
  return { files: [file], stats: { Clips: String(files.length), Output: formatBytes(file.bytes) } };
};

const audioArgs = (fmt: string, bitrate: number): string[] => {
  switch (fmt) {
    case "wav": return ["-vn", "-c:a", "pcm_s16le"];
    case "flac": return ["-vn", "-c:a", "flac"];
    case "ogg": return ["-vn", "-c:a", "libvorbis", "-b:a", `${bitrate}k`];
    case "m4a": return ["-vn", "-c:a", "aac", "-b:a", `${bitrate}k`];
    default: return ["-vn", "-c:a", "libmp3lame", "-b:a", `${bitrate}k`];
  }
};

export const extractAudio: FileProcessor = async (files, { options, onProgress, signal }) => {
  const fmt = String(options.format ?? "mp3");
  const bitrate = Number(options.bitrate ?? 192);
  return perFile(files, onProgress, signal, async (file, report) => {
    const out = `${baseName(file.name)}.${fmt}`;
    return toFile(out, await runFFmpeg(file, out, audioArgs(fmt, bitrate), report, signal), fmt);
  });
};

export const convertAudio = extractAudio;

export const compressAudio: FileProcessor = async (files, { options, onProgress, signal }) => {
  const bitrate = Number(options.bitrate ?? 96);
  return perFile(files, onProgress, signal, async (file, report) => {
    const out = `${baseName(file.name)}-compressed.mp3`;
    return toFile(out, await runFFmpeg(file, out, audioArgs("mp3", bitrate), report, signal), "mp3");
  });
};

export const trimAudio: FileProcessor = async (files, { options, onProgress, signal }) => {
  const start = parseTime(String(options.start ?? "0"));
  const end = parseTime(String(options.end ?? "30"));
  if (end <= start) throw new ProcessorError("End must be after start");
  return perFile(files, onProgress, signal, async (file, report) => {
    const out = `${baseName(file.name)}-cut.mp3`;
    return toFile(out, await runFFmpeg(file, out, ["-ss", String(start), "-to", String(end), ...audioArgs("mp3", 192)], report, signal), "mp3");
  });
};

export const mergeAudio: FileProcessor = async (files, { onProgress, signal }) => {
  if (files.length < 2) throw new ProcessorError("Add at least two audio files");
  const ff = await getFFmpeg(onProgress);
  const names: string[] = [];
  for (let i = 0; i < files.length; i++) {
    const n = `a${i}.${safeInputName(files[i].name).split(".").pop()}`;
    await ff.writeFile(n, new Uint8Array(await files[i].arrayBuffer()));
    names.push(n);
  }
  throwIfAborted(signal);
  const inputs = names.flatMap((n) => ["-i", n]);
  const filter = names.map((_, i) => `[${i}:a]`).join("") + `concat=n=${names.length}:v=0:a=1[out]`;
  await ff.exec([...inputs, "-filter_complex", filter, "-map", "[out]", "-c:a", "libmp3lame", "-b:a", "192k", "merged.mp3"]);
  const data = await ff.readFile("merged.mp3");
  for (const n of [...names, "merged.mp3"]) await ff.deleteFile(n).catch(() => {});
  if (typeof data === "string") throw new ProcessorError("Unexpected FFmpeg output");
  const file = toFile("merged.mp3", data, "mp3");
  return { files: [file], stats: { Tracks: String(files.length), Output: formatBytes(file.bytes) } };
};

export const toGif: FileProcessor = async (files, { options, onProgress, signal }) => {
  const start = parseTime(String(options.start ?? "0"));
  const duration = Number(options.duration ?? 5);
  const fps = Number(options.fps ?? 12);
  const width = Number(options.width ?? 480);
  return perFile(files, onProgress, signal, async (file, report) => {
    const out = `${baseName(file.name)}.gif`;
    const vf = `fps=${fps},scale=${width}:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse`;
    return toFile(out, await runFFmpeg(file, out, ["-ss", String(start), "-t", String(duration), "-vf", vf], report, signal), "gif");
  });
};

export const gifToVideo: FileProcessor = async (files, { onProgress, signal }) => {
  return perFile(files, onProgress, signal, async (file, report) => {
    const out = `${baseName(file.name)}.mp4`;
    const args = ["-movflags", "+faststart", "-pix_fmt", "yuv420p", "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2", "-c:v", "libx264", "-crf", "23"];
    return toFile(out, await runFFmpeg(file, out, args, report, signal), "mp4");
  });
};

/* ---------- Browser video element based tools (no FFmpeg) ---------- */

function loadVideo(file: File): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const v = document.createElement("video");
    v.preload = "auto";
    v.muted = true;
    v.playsInline = true;
    const url = URL.createObjectURL(file);
    v.onloadedmetadata = () => resolve(v);
    v.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new ProcessorError("This browser cannot decode this video", "Try converting it to MP4 first"));
    };
    v.src = url;
  });
}

function seek(v: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      v.removeEventListener("seeked", done);
      resolve();
    };
    v.addEventListener("seeked", done);
    v.currentTime = Math.min(Math.max(0, t), Math.max(0, v.duration - 0.05));
  });
}

async function frameAt(v: HTMLVideoElement, t: number): Promise<Blob> {
  await seek(v, t);
  const c = makeCanvas(v.videoWidth, v.videoHeight);
  ctx2d(c).drawImage(v, 0, 0);
  return canvasToBlob(c, "image/jpeg", 0.9);
}

export const thumbnail: FileProcessor = async (files, { options, onProgress }) => {
  const at = Number(options.at ?? 1);
  const outputs: ProcessorFile[] = [];
  for (let i = 0; i < files.length; i++) {
    const v = await loadVideo(files[i]);
    const blob = await frameAt(v, at);
    URL.revokeObjectURL(v.src);
    outputs.push(fileFromBlob(`${baseName(files[i].name)}-thumb.jpg`, blob));
    onProgress?.((i + 1) / files.length);
  }
  return { files: outputs };
};

export const frames: FileProcessor = async (files, { options, onProgress, signal }) => {
  const every = Math.max(0.1, Number(options.every ?? 1));
  const max = Math.max(1, Number(options.max ?? 60));
  const outputs: ProcessorFile[] = [];
  for (const file of files) {
    const v = await loadVideo(file);
    const shots: ProcessorFile[] = [];
    for (let t = 0, n = 0; t < v.duration && n < max; t += every, n++) {
      throwIfAborted(signal);
      shots.push(fileFromBlob(`${baseName(file.name)}-${String(n + 1).padStart(4, "0")}.jpg`, await frameAt(v, t)));
      onProgress?.(Math.min(0.99, t / v.duration), `${n + 1} frames`);
    }
    URL.revokeObjectURL(v.src);
    outputs.push(await zipFiles(shots, `${baseName(file.name)}-frames.zip`));
  }
  return { files: outputs };
};

export const metadata: FileProcessor = async (files) => {
  const results: Record<string, unknown>[] = [];
  for (const file of files) {
    if (file.type.startsWith("audio/")) {
      const a = document.createElement("audio");
      const url = URL.createObjectURL(file);
      const duration = await new Promise<number>((res) => {
        a.onloadedmetadata = () => res(a.duration);
        a.onerror = () => res(NaN);
        a.src = url;
      });
      URL.revokeObjectURL(url);
      results.push({ file: file.name, type: file.type, size: formatBytes(file.size), durationSeconds: isFinite(duration) ? +duration.toFixed(2) : "unknown" });
    } else {
      const v = await loadVideo(file);
      results.push({
        file: file.name,
        type: file.type,
        size: formatBytes(file.size),
        durationSeconds: +v.duration.toFixed(2),
        width: v.videoWidth,
        height: v.videoHeight,
        aspectRatio: (v.videoWidth / v.videoHeight).toFixed(3),
        estimatedBitrateKbps: Math.round((file.size * 8) / v.duration / 1000),
      });
      URL.revokeObjectURL(v.src);
    }
  }
  return jsonOutput(results.length === 1 ? results[0] : results);
};
