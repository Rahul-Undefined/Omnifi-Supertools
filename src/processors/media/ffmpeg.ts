import type { FFmpeg } from "@ffmpeg/ffmpeg";
import { ProcessorError, throwIfAborted } from "@/types/processor";

/**
 * FFmpeg WebAssembly, single-threaded build so it works without
 * cross-origin isolation headers. The core is fetched once from the
 * configured base URL (default: jsDelivr) and cached by the browser.
 * Override with NEXT_PUBLIC_FFMPEG_CORE_URL to self-host on the intranet.
 */
const CORE_VERSION = "0.12.10";
const BASE = process.env.NEXT_PUBLIC_FFMPEG_CORE_URL || `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${CORE_VERSION}/dist/umd`;

let instance: FFmpeg | null = null;
let loading: Promise<FFmpeg> | null = null;

export async function getFFmpeg(onProgress?: (f: number, label?: string) => void): Promise<FFmpeg> {
  if (instance) return instance;
  if (!loading) {
    loading = (async () => {
      onProgress?.(0.01, "Loading FFmpeg engine");
      const { FFmpeg } = await import("@ffmpeg/ffmpeg");
      const { toBlobURL } = await import("@ffmpeg/util");
      const ff = new FFmpeg();
      try {
        await ff.load({
          coreURL: await toBlobURL(`${BASE}/ffmpeg-core.js`, "text/javascript"),
          wasmURL: await toBlobURL(`${BASE}/ffmpeg-core.wasm`, "application/wasm"),
        });
      } catch (e) {
        loading = null;
        throw new ProcessorError(
          "Could not load the FFmpeg engine",
          `Check network access to ${BASE} or self-host the core (see docs/DEPLOYMENT.md). ${e instanceof Error ? e.message : ""}`,
        );
      }
      instance = ff;
      return ff;
    })();
  }
  return loading;
}

export function safeInputName(name: string): string {
  const ext = (name.split(".").pop() || "bin").replace(/[^a-z0-9]/gi, "").toLowerCase() || "bin";
  return `input.${ext}`;
}

/**
 * Run one FFmpeg job: write input, exec, read output, clean up.
 * `preInputArgs` go before -i (e.g. fast seeking).
 */
export async function runFFmpeg(
  file: File,
  outputName: string,
  args: string[],
  onProgress?: (f: number) => void,
  signal?: AbortSignal,
  preInputArgs: string[] = [],
): Promise<Uint8Array> {
  const ff = await getFFmpeg((f) => onProgress?.(f));
  const input = safeInputName(file.name);
  const output = `out.${outputName.split(".").pop()}`;
  const handler = ({ progress }: { progress: number }) => onProgress?.(Math.max(0.02, Math.min(0.99, progress)));
  ff.on("progress", handler);
  const abort = () => ff.terminate();
  signal?.addEventListener("abort", abort, { once: true });
  try {
    throwIfAborted(signal);
    await ff.writeFile(input, new Uint8Array(await file.arrayBuffer()));
    const code = await ff.exec([...preInputArgs, "-i", input, "-y", ...args, output]);
    if (code !== 0) throw new ProcessorError("FFmpeg could not process this file", "The format or codec may be unsupported in the WebAssembly build.");
    const data = await ff.readFile(output);
    if (typeof data === "string") throw new ProcessorError("Unexpected FFmpeg output");
    if (!data.length) throw new ProcessorError("FFmpeg produced an empty file");
    return data;
  } catch (e) {
    if (signal?.aborted) {
      instance = null;
      loading = null;
      throw new ProcessorError("Cancelled");
    }
    throw e;
  } finally {
    ff.off("progress", handler);
    signal?.removeEventListener("abort", abort);
    if (!signal?.aborted) {
      await ff.deleteFile(input).catch(() => {});
      await ff.deleteFile(output).catch(() => {});
    }
  }
}
