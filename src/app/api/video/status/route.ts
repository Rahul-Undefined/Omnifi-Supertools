import { NextResponse } from "next/server";
import { engine } from "@/lib/server/video";
import { env } from "@/lib/server/env";

export const dynamic = "force-dynamic";

/** Whether the download engine is present on this server (never exposes secrets). */
export async function GET() {
  const cap = await engine();
  return NextResponse.json({
    available: cap.ok,
    version: cap.version,
    ffmpeg: cap.ffmpeg,
    cookies: Boolean(env.ytdlpCookies),
    proxy: Boolean(env.ytdlpProxy),
    maxMb: env.videoMaxMb,
    hint: cap.ok ? undefined : "yt-dlp is not installed on this machine. It is part of the Docker image used on Render; for local development run `pip install yt-dlp` and install FFmpeg.",
  });
}
