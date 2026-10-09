"use client";
import { useState } from "react";
import { Check, Lightbulb } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { Input, Label, Select, Textarea } from "@/components/ui/Input";
import { tools } from "@/tools/registry";

export default function FeedbackPage() {
  const [name, setName] = useState("");
  const [kind, setKind] = useState("idea");
  const [tool, setTool] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/feedback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, kind, tool, message }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not send");
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl px-4 sm:px-6 py-10">
      <PageHeader title="Share an idea" description="Tell the SuperTools team what to build, fix or change. Everything lands on the admin page." icon="Lightbulb" />
      {done ? (
        <div className="rounded-control border border-success/40 bg-success-soft/40 p-8 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-success text-navy-800"><Check className="h-6 w-6" strokeWidth={3} /></span>
          <h2 className="mt-4 text-xl font-semibold text-foreground">Thanks, got it<span className="brand-dot">.</span></h2>
          <p className="mt-1 text-sm text-body">Your note is on the admin page for the team to review.</p>
          <Button className="mt-5" variant="secondary" onClick={() => { setDone(false); setMessage(""); }}>Send another</Button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-5 rounded-control border border-border bg-surface p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="fb-name">Your name (optional)</Label>
              <Input id="fb-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Rahul" />
            </div>
            <div>
              <Label htmlFor="fb-kind">Type</Label>
              <Select id="fb-kind" value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="idea">Idea for a new tool or feature</option>
                <option value="bug">Something is broken</option>
                <option value="question">Question</option>
                <option value="praise">This helped me</option>
              </Select>
            </div>
          </div>
          <div>
            <Label htmlFor="fb-tool">Related tool (optional)</Label>
            <Select id="fb-tool" value={tool} onChange={(e) => setTool(e.target.value)}>
              <option value="">General</option>
              {tools.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          </div>
          <div>
            <Label htmlFor="fb-message">What should we know?</Label>
            <Textarea id="fb-message" value={message} onChange={(e) => setMessage(e.target.value)} required minLength={3} className="min-h-[160px] font-sans text-sm" placeholder="e.g. A tool that splits a bank statement by month would save me an hour a week." />
          </div>
          {error && <p className="rounded-control-sm bg-error-soft px-3.5 py-2.5 text-sm text-foreground">{error}</p>}
          <div className="flex items-center gap-3">
            <Button type="submit" loading={busy}><Lightbulb className="h-4 w-4" /> Send</Button>
            <span className="text-xs text-muted">No files or personal data are collected; just this note.</span>
          </div>
        </form>
      )}
    </div>
  );
}
