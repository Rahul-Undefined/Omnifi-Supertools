import type { Metadata } from "next";
import Link from "next/link";
import { ShieldCheck, Laptop, Server, Lock, EyeOff, Clock, Globe, KeyRound, AlertTriangle, FileCheck2, Mail } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { site } from "@/config/site";

export const metadata: Metadata = { title: "Security & privacy" };

const LAST_REVIEWED = "13 October 2026";

/**
 * Plain-language trust page: how the portal works, where data goes, which
 * protection layers exist, and what is NOT in place. Every statement here is
 * backed by code in this repository (see docs/SECURITY.md for the technical
 * version). Nothing is claimed that has not been built.
 */
export default function TrustPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 sm:px-6 py-10">
      <PageHeader title="Security & privacy" description="How Omnifi SuperTools works, where your data goes, and the protection layers that keep it safe. Written for everyone on the team, not just IT." icon="ShieldCheck" />

      <p className="mb-8 rounded-control border border-accent/30 bg-accent-soft/40 p-4 text-sm text-body">
        <strong className="text-foreground">The short version:</strong> almost every tool runs inside your own browser. Your file never leaves your computer, nothing is uploaded, nothing is stored. The few features that do talk to the Omnifi server (sign-in, AI tools, web look-ups) send the minimum needed, keep nothing afterwards, and sit behind sign-in, rate limits and strict network rules.
      </p>

      <div className="space-y-6">
        <Section icon={<Laptop className="h-5 w-5" />} title="1. How the portal works">
          <p>SuperTools is a web app the Omnifi team opens in a browser. It is hosted on Render (a cloud platform) from a private GitHub repository that holds only code, never documents. When you open a tool such as Merge PDF, Excel consolidator or PPTX merger, the engine for that tool (PDF, spreadsheet, image, Office, OCR and video engines) is downloaded <em>to your browser</em> once and runs there as WebAssembly.</p>
          <ul>
            <li><strong>Browser tools (over 95% of the catalogue)</strong>: the file is read from your disk into the browser tab's memory, processed there, and the result is offered as a download. Close the tab and it is gone. No network request carries the file.</li>
            <li><strong>Server tools</strong> are marked with a "Server" badge on the tool page. They are: AI tools (your pasted text goes to the configured AI provider through the Omnifi server), web look-ups (only the URL you typed goes to the server), link checkers (only the links found in your file are checked), and the live exchange-rate feed.</li>
            <li><strong>Desktop helpers</strong> on the Downloads page (Steps Recorder) run entirely on your PC and send nothing anywhere.</li>
          </ul>
        </Section>

        <Section icon={<Server className="h-5 w-5" />} title="2. What the server does, and does not, keep">
          <table>
            <thead><tr><th>Data</th><th>Where it goes</th><th>Kept for</th></tr></thead>
            <tbody>
              <tr><td>Your documents, spreadsheets, PDFs, images, media</td><td>Stay in your browser</td><td>Not stored anywhere</td></tr>
              <tr><td>Text you paste into an AI tool</td><td>Omnifi server, then the AI provider; the server keeps nothing</td><td>Not stored. The log records the task name, character count and duration only</td></tr>
              <tr><td>URLs you look up with web tools</td><td>Omnifi server fetches the page</td><td>Only the host name is logged</td></tr>
              <tr><td>Usage statistics</td><td>Tool id, success or failure, duration, number of files</td><td>90 days, then purged automatically</td></tr>
              <tr><td>Sign-in audit</td><td>Account name, action, time, client IP</td><td>180 days</td></tr>
              <tr><td>Team feedback you submit</td><td>Stored in its own list, readable by admins only</td><td>365 days</td></tr>
              <tr><td>Your favourites and recently used tools</td><td>Saved against your account so they follow you between devices</td><td>365 days after last use</td></tr>
            </tbody>
          </table>
          <p>File names, file contents, AI prompts, passwords and sign-in tokens are never written to logs. Purges run automatically; nobody has to remember to delete anything.</p>
        </Section>

        <Section icon={<Lock className="h-5 w-5" />} title="3. Protection layers">
          <ol>
            <li><strong>Sign-in on everything.</strong> Every page and every API requires a signed-in Omnifi account (Microsoft 365 or a named account created by an admin). The server refuses to run "open": if no sign-in method is configured it answers "not available" instead of exposing tools.</li>
            <li><strong>Encrypted transport.</strong> HTTPS everywhere with HSTS, so browsers never fall back to plain HTTP.</li>
            <li><strong>Session security.</strong> Sessions are signed tokens in HttpOnly, SameSite cookies; "keep me signed in" lasts 30 days, otherwise the session ends when the browser closes. Passwords are stored as salted scrypt hashes.</li>
            <li><strong>Roles.</strong> Admin pages and admin APIs are limited to the admin role, checked on the server for every request.</li>
            <li><strong>Browser hardening.</strong> A strict Content Security Policy (no third-party scripts, no third-party connections, no framing by other sites), plus anti-sniffing, referrer and permissions policies on every response.</li>
            <li><strong>Safe previews.</strong> Anything the portal renders as HTML (for example a Markdown preview) is cleaned with an allowlist sanitiser and shown inside an isolated, script-free frame.</li>
            <li><strong>Outbound request guard.</strong> Web tools can only reach public internet addresses. Internal networks, cloud metadata services, localhost and private ranges are blocked, the resolved address is pinned for the connection, and every redirect is re-checked.</li>
            <li><strong>Rate limits and quotas.</strong> Per-user limits per minute and per day on AI and web tools; sign-in attempts are limited and failures are audited.</li>
            <li><strong>Cross-site request protection.</strong> Every action that changes something checks that the request came from the portal itself.</li>
            <li><strong>Self-hosted engines.</strong> All processing engines are served by the portal itself, so no document-processing code is loaded from a third-party CDN.</li>
          </ol>
        </Section>

        <Section icon={<EyeOff className="h-5 w-5" />} title="4. AI tools, specifically">
          <p>AI tools are optional and clearly labelled. When used, the text you provide is sent through the Omnifi server to the AI provider configured by an administrator (shown on the AI page). The provider key lives only on the server, never in the browser. Inputs are capped in size, wrapped so the model treats them as data rather than instructions, and the server stores neither the prompt nor the answer. If no provider is configured the tools say so instead of pretending to work.</p>
        </Section>

        <Section icon={<Globe className="h-5 w-5" />} title="5. Hosting and infrastructure certifications">
          <p>The app runs as a single container on Render (render.com) in the United States, on infrastructure provided by Amazon Web Services and Google Cloud. Each deployment is built from the GitHub repository; the container runs as a non-privileged user and holds no documents. Secrets (session key, AI key, sign-in configuration) are set in the hosting dashboard and are not in the code. Health checks expose nothing but "ok".</p>
          <p><strong>Render's independently audited certifications</strong> (they cover the hosting platform: physical security, network, operations and Render staff access):</p>
          <ul>
            <li><strong>SOC 2 Type 2</strong>: annual third-party audit of security, confidentiality and availability controls.</li>
            <li><strong>ISO/IEC 27001:2022</strong>: certified information security management system.</li>
            <li><strong>GDPR</strong> data processing agreement, and certification under the <strong>EU-US Data Privacy Framework</strong> (with the UK extension and Swiss-US DPF).</li>
            <li>HIPAA-enabled workspaces exist on Render for health data; SuperTools does not use one and does not process health data.</li>
          </ul>
          <p>Render publishes its SOC 3 report to every customer and its SOC 2 report and ISO certificate on request. Source: <a href="https://render.com/trust" target="_blank" rel="noopener noreferrer">render.com/trust</a> and <a href="https://render.com/docs/certifications-compliance" target="_blank" rel="noopener noreferrer">Render's compliance documentation</a>, checked {LAST_REVIEWED}.</p>
          <p>What this does and does not mean: these certifications assure the <em>platform underneath</em> SuperTools. The SuperTools application itself (the code in this repository) is protected by the layers in section 3 and by automated tests, but has not been separately audited; see section 7.</p>
        </Section>

        <Section icon={<KeyRound className="h-5 w-5" />} title="6. What you can do">
          <ul>
            <li>Use your Microsoft 365 sign-in; do not share named-account passwords.</li>
            <li>Prefer browser tools for anything confidential. The tool page tells you where it runs before you add a file.</li>
            <li>Before sending a deck or document to a client, use the "clean copy" tools to strip notes, comments, hidden content and metadata.</li>
            <li>Only paste into AI tools what you would be comfortable sending to an external provider.</li>
          </ul>
        </Section>

        <Section icon={<AlertTriangle className="h-5 w-5" />} title="7. Honest limits">
          <ul>
            <li>The SuperTools application itself has <strong>no third-party certification or penetration-test report</strong> of its own. The hosting platform's SOC 2 Type 2 and ISO 27001 (section 5) cover the infrastructure, not this code. The application controls are self-built, documented in the repository and covered by automated tests.</li>
            <li>On the current free hosting plan the service sleeps when idle and its small file store resets on redeploy; a database can be attached to make usage records and preferences durable.</li>
            <li>AI providers process text under their own terms; check with the admin which provider is active before using AI tools for sensitive material.</li>
            <li>Security is a moving target. This page is updated whenever the controls change.</li>
          </ul>
        </Section>

        <Section icon={<FileCheck2 className="h-5 w-5" />} title="8. For IT and auditors">
          <p>The technical version of this page, including the threat model, headers, SSRF rules, retention settings and the test suite that enforces them, is in the repository under <code>docs/SECURITY.md</code> and <code>docs/DEPLOYMENT.md</code>. Ask the administrator for access.</p>
        </Section>
      </div>

      <div className="mt-10 flex flex-wrap items-center justify-between gap-3 rounded-control border border-border bg-surface p-4 text-sm text-muted">
        <span className="inline-flex items-center gap-2"><Clock className="h-4 w-4" /> Last reviewed {LAST_REVIEWED}</span>
        <span className="inline-flex items-center gap-2"><Mail className="h-4 w-4" /> Questions or concerns: {site.support.name}, <a href={`mailto:${site.support.email}`} className="text-accent hover:underline">{site.support.email}</a></span>
        <Link href="/help" className="text-accent hover:underline">Help &amp; shortcuts</Link>
      </div>
    </div>
  );
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-control border border-border bg-surface p-6">
      <h2 className="flex items-center gap-2.5 text-lg font-semibold text-foreground"><span className="text-accent">{icon}</span>{title}<span className="brand-dot">.</span></h2>
      <div className="prose-omnifi mt-3 space-y-3 text-sm text-body [&_li]:ml-5 [&_li]:list-disc [&_ol_li]:list-decimal [&_table]:w-full [&_td]:border-t [&_td]:border-border [&_td]:px-2 [&_td]:py-1.5 [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-semibold [&_th]:text-foreground [&_code]:rounded [&_code]:bg-surface-2 [&_code]:px-1 [&_strong]:text-foreground">{children}</div>
    </section>
  );
}
