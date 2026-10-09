"use client";
import type { OptionField, OptionValues } from "@/types/tool";
import { Input, Label, Select, Textarea } from "@/components/ui/Input";

export function defaultOptions(fields: OptionField[] = []): OptionValues {
  return Object.fromEntries(fields.map((f) => [f.key, f.default]));
}

export function OptionsForm({ fields, values, onChange, disabled }: { fields: OptionField[]; values: OptionValues; onChange: (v: OptionValues) => void; disabled?: boolean }) {
  if (!fields.length) return null;
  const set = (k: string, v: string | number | boolean) => onChange({ ...values, [k]: v });
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {fields.map((f) => {
        const id = `opt-${f.key}`;
        const wide = f.type === "textarea";
        return (
          <div key={f.key} className={wide ? "sm:col-span-2" : undefined}>
            {f.type === "checkbox" ? (
              <label className="flex items-center gap-2.5 text-sm text-foreground cursor-pointer select-none h-11">
                <input id={id} type="checkbox" disabled={disabled} checked={Boolean(values[f.key])} onChange={(e) => set(f.key, e.target.checked)} className="h-4 w-4 rounded border-border-strong accent-[var(--indigo)]" />
                <span>{f.label}{f.help && <span className="block text-xs text-muted">{f.help}</span>}</span>
              </label>
            ) : (
              <>
                <Label htmlFor={id} hint={f.help}>{f.label}{f.type === "range" && <span className="ml-2 font-mono text-xs text-accent">{values[f.key]}</span>}</Label>
                {f.type === "select" && (
                  <Select id={id} disabled={disabled} value={String(values[f.key])} onChange={(e) => set(f.key, e.target.value)}>
                    {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </Select>
                )}
                {f.type === "number" && <Input id={id} type="number" disabled={disabled} value={String(values[f.key])} min={f.min} max={f.max} step={f.step ?? "any"} onChange={(e) => set(f.key, e.target.value === "" ? "" : Number(e.target.value))} />}
                {f.type === "range" && <input id={id} type="range" disabled={disabled} value={Number(values[f.key])} min={f.min} max={f.max} step={f.step ?? 1} onChange={(e) => set(f.key, Number(e.target.value))} className="w-full h-11 accent-[var(--indigo)]" />}
                {f.type === "text" && <Input id={id} disabled={disabled} value={String(values[f.key])} placeholder={f.placeholder} onChange={(e) => set(f.key, e.target.value)} />}
                {f.type === "textarea" && <Textarea id={id} disabled={disabled} value={String(values[f.key])} placeholder={f.placeholder} onChange={(e) => set(f.key, e.target.value)} />}
                {f.type === "color" && (
                  <div className="flex items-center gap-2">
                    <input id={id} type="color" disabled={disabled} value={String(values[f.key])} onChange={(e) => set(f.key, e.target.value)} className="h-11 w-14 cursor-pointer rounded-control-sm border border-border-strong bg-surface p-1" />
                    <Input aria-label={`${f.label} hex`} disabled={disabled} value={String(values[f.key])} onChange={(e) => set(f.key, e.target.value)} className="font-mono" />
                  </div>
                )}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
