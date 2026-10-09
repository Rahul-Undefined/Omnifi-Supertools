import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { WorkflowBuilder } from "@/components/workflows/WorkflowBuilder";

export const metadata: Metadata = { title: "Workflows" };

export default function WorkflowsPage() {
  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 py-10">
      <PageHeader title="Workflows" description="Chain browser-side tools so one upload runs a whole pipeline. Workflows are saved in this browser." icon="Workflow" />
      <Suspense fallback={null}>
        <WorkflowBuilder />
      </Suspense>
    </div>
  );
}
