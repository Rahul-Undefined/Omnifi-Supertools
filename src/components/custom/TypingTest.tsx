"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RotateCcw, Timer, Type as TypeIcon } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Kbd } from "@/components/ui/Card";
import { cn } from "@/lib/utils";

/**
 * Typing speed test. Original implementation: a stream of common English
 * words, timed or fixed-length modes, live WPM, and a results card.
 * Everything runs in the browser; best results are kept in local storage.
 */
const WORDS = (
  "the of and to in a is that for it as was with be by on not he this are or his from at which but have an they you were her she all their one we can has there been if more when will would who so no what up out into her time some them than then two only other like its also could into over new just year first any these my now such because way may after most well back where much your good how through long down day our these see well little any same another know while last might great old come should still think each work being those way even must high through may find part right place world before made here give government against ..."
).replace(/\.\.\./g, "").split(/\s+/).filter((w) => w.length > 1);

const EXTRA = "ledger balance invoice payroll reconcile close report client quarter revenue expense budget audit tax deposit transfer statement vendor account journal entry forecast margin cash credit debit approve review submit update number period month".split(" ");
const BANK = [...new Set([...WORDS, ...EXTRA])];

type Mode = { kind: "time"; seconds: number } | { kind: "words"; count: number };
const MODES: { label: string; mode: Mode }[] = [
  { label: "15s", mode: { kind: "time", seconds: 15 } },
  { label: "30s", mode: { kind: "time", seconds: 30 } },
  { label: "60s", mode: { kind: "time", seconds: 60 } },
  { label: "25 words", mode: { kind: "words", count: 25 } },
  { label: "50 words", mode: { kind: "words", count: 50 } },
];

function pickWords(n: number): string[] {
  const out: string[] = [];
  let last = "";
  while (out.length < n) {
    const w = BANK[Math.floor(Math.random() * BANK.length)];
    if (w !== last) { out.push(w); last = w; }
  }
  return out;
}

interface Result { wpm: number; raw: number; accuracy: number; correct: number; incorrect: number; seconds: number; mode: string; at: number }

const STORAGE = "omnifi-supertools-typing";

export function TypingTest() {
  const [modeIdx, setModeIdx] = useState(1);
  const mode = MODES[modeIdx].mode;
  const [words, setWords] = useState<string[]>(() => pickWords(mode.kind === "words" ? mode.count : 120));
  const [typed, setTyped] = useState<string[]>([""]); // typed text per word index
  const [started, setStarted] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const [focused, setFocused] = useState(false);
  const [best, setBest] = useState<Record<string, number>>(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE) || "{}"); } catch { return {}; }
  });
  const inputRef = useRef<HTMLInputElement>(null);
  const wordRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  const reset = useCallback((idx = modeIdx) => {
    const m = MODES[idx].mode;
    setWords(pickWords(m.kind === "words" ? m.count : 120));
    setTyped([""]);
    setStarted(null);
    setNow(0);
    setResult(null);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [modeIdx]);

  const finishRef = useRef<() => void>(() => {});

  // Timer tick; also ends timed tests when the clock runs out.
  useEffect(() => {
    if (!started || result) return;
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (mode.kind === "time" && (t - started) / 1000 >= mode.seconds) finishRef.current();
    }, 100);
    return () => clearInterval(id);
  }, [started, result, mode]);

  const elapsed = started ? (now - started) / 1000 : 0;
  const remaining = mode.kind === "time" ? Math.max(0, mode.seconds - elapsed) : null;

  const stats = useMemo(() => {
    let correct = 0, incorrect = 0, correctWords = 0;
    typed.forEach((t, i) => {
      const target = words[i] ?? "";
      const done = i < typed.length - 1;
      for (let k = 0; k < t.length; k++) { if (t[k] === target[k]) correct++; else incorrect++; }
      if (done) { if (t === target) correctWords++; correct++; } // space counts as a char
    });
    const minutes = Math.max(elapsed, 0.5) / 60;
    const wpm = correctWords / minutes * (correctWords ? 1 : 0);
    const raw = (correct + incorrect) / 5 / minutes;
    const accuracy = correct + incorrect ? (correct / (correct + incorrect)) * 100 : 100;
    return { correct, incorrect, correctWords, wpm, raw, accuracy };
  }, [typed, words, elapsed]);

  const finish = useCallback(() => {
    if (result || !started) return;
    const seconds = (Date.now() - started) / 1000;
    const minutes = Math.max(seconds, 1) / 60;
    const r: Result = { wpm: Math.round(stats.correctWords / minutes), raw: Math.round((stats.correct + stats.incorrect) / 5 / minutes), accuracy: Math.round(stats.accuracy * 10) / 10, correct: stats.correct, incorrect: stats.incorrect, seconds: Math.round(seconds), mode: MODES[modeIdx].label, at: Date.now() };
    setResult(r);
    setBest((b) => {
      const next = { ...b, [r.mode]: Math.max(b[r.mode] ?? 0, r.wpm) };
      try { localStorage.setItem(STORAGE, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, [result, started, stats, modeIdx]);

  useEffect(() => {
    finishRef.current = finish;
  }, [finish]);

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (result) { if (e.key === "Tab" || e.key === "Enter") { e.preventDefault(); reset(); } return; }
    if (e.key === "Tab") { e.preventDefault(); reset(); return; }
    if (e.key === "Escape") { reset(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const idx = typed.length - 1;
    if (e.key === "Backspace") {
      e.preventDefault();
      setTyped((t) => {
        const copy = [...t];
        if (copy[idx].length) copy[idx] = copy[idx].slice(0, -1);
        else if (idx > 0 && copy[idx - 1] !== words[idx - 1]) copy.pop(); // allow fixing a wrong previous word
        return copy;
      });
      return;
    }
    if (e.key === " ") {
      e.preventDefault();
      if (!typed[idx]) return;
      if (!started) setStarted(Date.now());
      const next = [...typed, ""];
      setTyped(next);
      if (mode.kind === "words" && next.length > words.length) finish();
      // Timed mode: keep the word stream ahead of the cursor.
      if (mode.kind === "time" && next.length > words.length - 30) setWords((w) => [...w, ...pickWords(60)]);
      return;
    }
    if (e.key.length === 1) {
      e.preventDefault();
      if (!started) { setStarted(Date.now()); setNow(Date.now()); }
      setTyped((t) => {
        const copy = [...t];
        if (copy[idx].length < (words[idx]?.length ?? 0) + 8) copy[idx] += e.key;
        return copy;
      });
      const isLastWord = idx === words.length - 1;
      if (mode.kind === "words" && isLastWord && typed[idx] + e.key === words[idx]) setTimeout(finish, 0);
    }
  };

  // Keep the active word visible (scroll the 3-line window).
  useEffect(() => {
    const el = wordRefs.current[typed.length - 1];
    const box = containerRef.current;
    if (el && box) {
      const top = el.offsetTop - box.offsetTop;
      if (top > box.clientHeight * 0.55) box.scrollTo({ top: top - box.clientHeight * 0.3, behavior: "smooth" });
    }
  }, [typed.length]);

  const liveWpm = started && !result ? Math.round(stats.wpm) : 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1 rounded-control border border-border bg-surface p-1" role="tablist" aria-label="Test mode">
          {MODES.map((m, i) => (
            <button key={m.label} role="tab" aria-selected={i === modeIdx} type="button" onClick={() => { setModeIdx(i); reset(i); }} className={cn("rounded-control-sm px-3 py-1.5 text-sm font-medium transition-colors", i === modeIdx ? "bg-accent text-accent-foreground" : "text-body hover:bg-surface-2")}>
              {m.mode.kind === "time" ? <Timer className="mr-1 inline h-3.5 w-3.5" /> : <TypeIcon className="mr-1 inline h-3.5 w-3.5" />}{m.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-4 font-mono text-sm text-muted">
          {remaining !== null && <span className={cn("text-2xl text-accent tabular-nums", remaining <= 5 && started && !result && "text-error")}>{Math.ceil(remaining)}s</span>}
          {mode.kind === "words" && <span className="text-2xl text-accent tabular-nums">{Math.min(typed.length - 1, words.length)}/{words.length}</span>}
          <span>{liveWpm} wpm</span>
          {best[MODES[modeIdx].label] ? <span>best {best[MODES[modeIdx].label]}</span> : null}
        </div>
      </div>

      {result ? (
        <div className="rounded-control border border-success/40 bg-success-soft/40 p-6 animate-fade-up">
          <div className="grid gap-4 sm:grid-cols-4">
            <Stat label="WPM" value={String(result.wpm)} big />
            <Stat label="Accuracy" value={`${result.accuracy}%`} />
            <Stat label="Raw WPM" value={String(result.raw)} />
            <Stat label="Characters" value={`${result.correct} / ${result.incorrect}`} hint="correct / wrong" />
          </div>
          <p className="mt-4 text-sm text-muted">{result.mode} · {result.seconds}s{best[result.mode] === result.wpm ? " · new personal best" : ""}</p>
          <div className="mt-4 flex items-center gap-3">
            <Button onClick={() => reset()}><RotateCcw className="h-4 w-4" /> Try again</Button>
            <span className="flex items-center gap-1 text-xs text-muted"><Kbd>Tab</Kbd> restarts</span>
          </div>
        </div>
      ) : (
        <div className="relative" onClick={() => inputRef.current?.focus()}>
          <div ref={containerRef} className={cn("max-h-[7.5rem] overflow-hidden rounded-control border border-border bg-surface px-6 py-5 font-mono text-[1.45rem] leading-[2.5rem] select-none transition-[filter]", !focused && "blur-[2px]")} aria-hidden>
            {words.map((w, wi) => {
              const t = typed[wi] ?? "";
              const active = wi === typed.length - 1;
              const extra = t.length > w.length ? t.slice(w.length) : "";
              return (
                <span key={wi} ref={(el) => { wordRefs.current[wi] = el; }} className={cn("mr-[0.6em] inline-block", wi < typed.length - 1 && t !== w && "underline decoration-error decoration-2 underline-offset-4")}>
                  {w.split("").map((ch, ci) => {
                    const typedCh = t[ci];
                    const cls = typedCh === undefined ? "text-muted/60" : typedCh === ch ? "text-foreground" : "text-error";
                    return (
                      <span key={ci} className={cn(cls, "relative")}>
                        {active && ci === t.length && <span className="absolute -left-px top-1 h-7 w-0.5 animate-pulse bg-accent" />}
                        {ch}
                      </span>
                    );
                  })}
                  {extra && <span className="text-error/70">{extra}</span>}
                  {active && t.length >= w.length && <span className="relative"><span className="absolute -left-px top-1 h-7 w-0.5 animate-pulse bg-accent" /></span>}
                </span>
              );
            })}
          </div>
          {!focused && <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm font-medium text-foreground">Click here or start typing</div>}
          <input ref={inputRef} className="absolute left-0 top-0 h-0 w-0 opacity-0" aria-label="Typing area" autoFocus autoCapitalize="off" autoCorrect="off" spellCheck={false} onKeyDown={onKey} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} />
        </div>
      )}

      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        <span><Kbd>Tab</Kbd> restart</span>
        <span><Kbd>Esc</Kbd> reset</span>
        <span>WPM counts correctly typed words (5 characters each). Raw counts everything typed.</span>
      </p>
    </div>
  );
}

function Stat({ label, value, hint, big }: { label: string; value: string; hint?: string; big?: boolean }) {
  return (
    <div className="rounded-control-sm bg-surface/70 px-4 py-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className={cn("mt-0.5 font-mono text-accent", big ? "text-4xl" : "text-2xl")}>{value}</p>
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}
