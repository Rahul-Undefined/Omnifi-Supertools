"use client";
import { Download, MonitorPlay, Keyboard, FolderOpen, ShieldCheck } from "lucide-react";
import { site } from "@/config/site";

/** Download card and quick-start for the Omnifi Steps Recorder (Windows desktop app). */
export function StepsRecorderDownload() {
  return (
    <div className="space-y-6">
      <div className="rounded-control border border-border bg-surface p-6 sm:p-8 flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
        <div className="flex items-start gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-control bg-accent-soft text-accent"><MonitorPlay className="h-6 w-6" /></span>
          <div>
            <h2 className="text-lg font-semibold text-foreground">Omnifi Steps Recorder for Windows<span className="brand-dot">.</span></h2>
            <p className="mt-1 text-sm text-body max-w-xl">Records your screen as a video plus a click-by-click report (HTML, Word, screenshots). Nothing to install, no admin rights, and nothing leaves your computer.</p>
            <p className="mt-2 text-xs text-muted">ZIP · about 69 MB · Windows 10/11 64-bit · version 2026-10-23</p>
          </div>
        </div>
        <a href={site.links.stepsRecorder} download className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-control bg-accent px-5 text-sm font-semibold text-accent-foreground hover:bg-accent-hover transition-colors">
          <Download className="h-4 w-4" /> Download ZIP
        </a>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Step icon={<FolderOpen className="h-5 w-5" />} title="1. Unzip anywhere" text="Right-click the ZIP, choose Extract All, and keep the whole folder together (for example in Documents). Do not move files inside the program folder." />
        <Step icon={<MonitorPlay className="h-5 w-5" />} title="2. Start it" text='Double-click "Start Steps Recorder.vbs". It opens through Windowsâ€™ own signed components, so it also works on laptops that block unknown .exe files.' />
        <Step icon={<Keyboard className="h-5 w-5" />} title="3. Record" text="Pick a save folder, click Start recording and work as normal. Every click becomes a step with a screenshot; drag to highlight an area. Press Left Ctrl + Right Ctrl together to open it at any time." />
        <Step icon={<ShieldCheck className="h-5 w-5" />} title="4. Share the result" text="Stop creates a folder with screen.mp4, steps.html, steps.docx, a summary and screenshots. Export ZIP makes one file to send. Pause before anything private; the screen is captured as-is." />
      </div>

      <p className="text-xs text-muted">Microphone narration is off unless you tick it. The SuperTools button inside the app only opens this website. Questions: {site.support.name}, <a href={`mailto:${site.support.email}`} className="text-accent hover:underline">{site.support.email}</a>.</p>

    </div>
  );
}

function Step({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className="rounded-control border border-border bg-surface p-5">
      <div className="flex items-center gap-2.5 text-foreground"><span className="text-accent">{icon}</span><h3 className="text-sm font-semibold">{title}</h3></div>
      <p className="mt-2 text-sm text-body">{text}</p>
    </div>
  );
}
