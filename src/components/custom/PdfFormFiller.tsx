"use client";
import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input, Label, Select } from "@/components/ui/Input";
import { PdfToolShell, useOutput } from "./PdfToolShell";
import type { FormFieldInfo } from "@/processors/pdf/advanced";
import type { ProcessorOutput } from "@/types/processor";

export function PdfFormFiller() {
  const o = useOutput();
  return (
    <PdfToolShell hint="Upload a fillable PDF form. Fields are detected automatically." output={o.output} onReset={o.reset} progress={o.progress}>
      {(file) => <Editor file={file} onDone={o.setOutput} />}
    </PdfToolShell>
  );
}

function Editor({ file, onDone }: { file: File; onDone: (o: ProcessorOutput) => void }) {
  const [fields, setFields] = useState<FormFieldInfo[] | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [flatten, setFlatten] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    import("@/processors/pdf/advanced").then(async ({ readFormFields }) => {
      try {
        const f = await readFormFields(file);
        if (cancelled) return;
        setFields(f);
        setValues(Object.fromEntries(f.map((x) => [x.name, x.value])));
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not read this PDF");
      }
    });
    return () => { cancelled = true; };
  }, [file]);

  const submit = async () => {
    setBusy(true);
    try {
      const { fillForm } = await import("@/processors/pdf/advanced");
      const out = await fillForm(file, values, flatten, file.name);
      onDone({ files: [out], stats: { Fields: String(fields?.length ?? 0), Flattened: flatten ? "Yes" : "No" } });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not fill the form");
    } finally {
      setBusy(false);
    }
  };

  if (error) return <p className="rounded-control bg-error-soft px-4 py-3 text-sm">{error}</p>;
  if (!fields) return <div className="h-40 animate-pulse rounded-control bg-surface-2" />;
  if (!fields.length) return <p className="rounded-control border border-warning/40 bg-warning-soft px-4 py-3 text-sm text-foreground">This PDF has no fillable form fields. Use the signature stamp tool to place text or an image instead.</p>;

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        {fields.map((f) => {
          const id = `ff-${f.name}`;
          const set = (v: string) => setValues((s) => ({ ...s, [f.name]: v }));
          return (
            <div key={f.name} className={f.type === "text" && f.name.length > 30 ? "sm:col-span-2" : undefined}>
              {f.type === "checkbox" ? (
                <label className="flex h-11 cursor-pointer items-center gap-2.5 text-sm text-foreground"><input type="checkbox" checked={values[f.name] === "true"} onChange={(e) => set(e.target.checked ? "true" : "false")} disabled={f.readOnly} className="h-4 w-4 accent-[var(--indigo)]" /> {f.name}</label>
              ) : (
                <>
                  <Label htmlFor={id}>{f.name}{f.readOnly && <span className="ml-1 text-xs text-muted">(read-only)</span>}</Label>
                  {(f.type === "radio" || f.type === "dropdown") && f.options ? (
                    <Select id={id} value={values[f.name] ?? ""} onChange={(e) => set(e.target.value)} disabled={f.readOnly}>
                      <option value="">—</option>
                      {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
                    </Select>
                  ) : (
                    <Input id={id} value={values[f.name] ?? ""} onChange={(e) => set(e.target.value)} disabled={f.readOnly} placeholder={f.type === "optionlist" ? "Comma-separated choices" : undefined} />
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <Button onClick={submit} loading={busy}><Download className="h-4 w-4" /> Download filled PDF</Button>
        <label className="flex items-center gap-2 text-sm text-foreground"><input type="checkbox" checked={flatten} onChange={(e) => setFlatten(e.target.checked)} className="h-4 w-4 accent-[var(--indigo)]" /> Flatten (lock the values so they cannot be edited)</label>
      </div>
    </div>
  );
}
