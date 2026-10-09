import type { Metadata } from "next";
import { site } from "@/config/site";
import { PageHeader } from "@/components/layout/PageHeader";
import { Kbd } from "@/components/ui/Card";

export const metadata: Metadata = { title: "Help" };

export default function HelpPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 py-10">
      <PageHeader title="Help & shortcuts" description="How SuperTools handles your files, and the keyboard shortcuts that make it fast." icon="CircleHelp" />
      <section className="rounded-control border border-border bg-surface p-6">
        <h2 className="text-lg font-semibold text-foreground">Keyboard shortcuts<span className="brand-dot">.</span></h2>
        <ul className="mt-4 divide-y divide-border">
          {site.shortcuts.map((s) => (
            <li key={s.keys} className="flex items-center justify-between py-3 text-sm">
              <span className="text-body">{s.action}</span>
              <span className="flex items-center gap-1">{s.keys.split(" + ").map((k) => <Kbd key={k}>{k}</Kbd>)}</span>
            </li>
          ))}
        </ul>
      </section>
      <section className="mt-8 rounded-control border border-border bg-surface p-6 space-y-4 text-sm text-body">
        <h2 className="text-lg font-semibold text-foreground">Where your files go<span className="brand-dot">.</span></h2>
        <p><strong className="text-foreground">Browser tools</strong> (the large majority) do all the work on your computer. Nothing is uploaded. Close the tab and it is gone.</p>
        <p><strong className="text-foreground">Server tools</strong> are marked with a “Server” badge. Input is sent to the Omnifi server, processed in a temporary location, and deleted as soon as the result is returned. Only the tool name, timing and success/failure are recorded for usage statistics, never file contents or names.</p>
        <p><strong className="text-foreground">AI tools</strong> send your text to the AI provider configured by an administrator. Check the AI page to see which provider is active.</p>
        <p><strong className="text-foreground">Coming soon</strong> tools are listed so you know what is planned. They never pretend to run.</p>
      </section>
      <section className="mt-8 rounded-control border border-border bg-surface p-6 space-y-3 text-sm text-body">
        <h2 className="text-lg font-semibold text-foreground">Tips<span className="brand-dot">.</span></h2>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Most file tools accept many files at once and show per-file progress with retry for failures.</li>
          <li>Chain tools on the Workflows page: for example OCR, then Extract tables, then CSV to Excel.</li>
          <li>Press <Kbd>F</Kbd> on any tool page to favorite it. Favorites appear on the home page.</li>
          <li>Video, audio and OCR engines are served by SuperTools itself (no third-party downloads). The first use loads about 30 MB, cached afterwards.</li>
          <li>Have an idea or found a bug? Use <a href="/feedback" className="text-accent underline">Share an idea</a>; notes go straight to the admin page.</li>
        </ul>
      </section>
    </div>
  );
}
