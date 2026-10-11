import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/PageHeader";
import { StepsRecorderDownload } from "@/components/custom/StepsRecorderDownload";

export const metadata: Metadata = { title: "Downloads" };

export default function DownloadsPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 sm:px-6 py-10">
      <PageHeader title="Downloads" description="Desktop helpers built for the Omnifi team. Download from here instead of passing ZIPs around." icon="Download" />
      <StepsRecorderDownload />
    </div>
  );
}
