import { NextResponse } from "next/server";
import { registryStats } from "@/tools/registry";
import { aiStatus } from "@/lib/server/ai";
import { env } from "@/lib/server/env";
import { engine } from "@/lib/server/video";

export const dynamic = "force-dynamic";

export async function GET() {
  const video = await engine();
  return NextResponse.json({
    ok: true,
    version: process.env.npm_package_version ?? "0.1.0",
    uptimeSeconds: Math.round(process.uptime()),
    registry: registryStats(),
    ai: aiStatus().configured,
    storage: env.databaseUrl ? "postgres" : "file",
    video: video.ok ? { engine: video.version, ffmpeg: video.ffmpeg } : false,
    time: new Date().toISOString(),
  });
}
