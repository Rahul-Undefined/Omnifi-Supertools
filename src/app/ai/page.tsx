import type { Metadata } from "next";
import { toolsInCategory } from "@/tools/registry";
import { ToolGridSplit } from "@/components/tools/ToolGrid";
import { PageHeader } from "@/components/layout/PageHeader";
import { AiStatusBanner } from "@/components/ai/AiStatusBanner";

export const metadata: Metadata = { title: "AI tools" };

export default function AiPage() {
  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 py-10">
      <PageHeader title="AI tools" description="Summarize, extract, translate and rewrite. Requests go through the OmniFi server to the configured provider; API keys never reach the browser." icon="Sparkles" />
      <AiStatusBanner />
      <ToolGridSplit tools={toolsInCategory("ai")} />
    </div>
  );
}
