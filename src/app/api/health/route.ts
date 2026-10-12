import { NextResponse } from "next/server";
import { registryStats } from "@/tools/registry";
import { aiStatus } from "@/lib/server/ai";
import { env } from "@/lib/server/env";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    ok: true,
    version: process.env.npm_package_version ?? "0.1.0",
    uptimeSeconds: Math.round(process.uptime()),
    registry: registryStats(),
    ai: aiStatus().configured,
    storage: env.databaseUrl ? "postgres" : "file",
    time: new Date().toISOString(),
  });
}
