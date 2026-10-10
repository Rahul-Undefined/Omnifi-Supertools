import { NextResponse } from "next/server";
import { currentUser, localAuthConfigured, microsoftConfigured, authRequired, firstName } from "@/lib/server/auth";
import { env } from "@/lib/server/env";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await currentUser();
  return NextResponse.json({
    user: user ? { ...user, firstName: firstName(user) } : null,
    mode: env.authMode,
    required: authRequired(),
    methods: { microsoft: microsoftConfigured(), local: localAuthConfigured() || true },
    configured: authRequired(),
  });
}
