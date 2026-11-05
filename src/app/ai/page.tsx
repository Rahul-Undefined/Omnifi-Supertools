import type { Metadata } from "next";
import { toolsInCategory } from "@/tools/registry";
import { ToolGridSplit } from "@/components/tools/ToolGrid";
import { PageHeader } from "@/components/layout/PageHeader";
import { AiStatusBanner } from "@/components/ai/AiStatusBanner";

export const metadata: Metadata = { title: "AI tools (beta)" };

export default function AiPage() {
  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 py-10">
      <PageHeader title="AI tools (beta)" description="Summarize, extract, translate and rewrite. Beta: runs on a free provider tier and can fail under heavy use while we move to a paid plan. Requests go through the Omnifi server to the configured provider; API keys never reach the browser." icon="Sparkles" />
      <AiStatusBanner />
      <ToolGridSplit tools={toolsInCategory("ai")} />
    </div>
  );
}
