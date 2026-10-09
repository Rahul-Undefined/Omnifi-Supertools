import { NextResponse } from "next/server";
import { aiStatus } from "@/lib/server/ai";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(aiStatus());
}
