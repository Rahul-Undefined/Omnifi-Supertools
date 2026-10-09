import { NextResponse } from "next/server";
import { currentUser, localAuthConfigured } from "@/lib/server/auth";
import { env } from "@/lib/server/env";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await currentUser();
  return NextResponse.json({ user, mode: env.authMode, configured: env.authMode === "header" || localAuthConfigured() });
}
