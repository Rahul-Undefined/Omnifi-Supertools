"use client";
import { useEffect, useRef, useState } from "react";
import { Mic, Square, Volume2, Copy, Check, Download } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Label, Select, Textarea } from "@/components/ui/Input";
import { downloadBlob } from "@/lib/files";

/* Both tools use the browser's built-in speech engines. Nothing is uploaded. */

export function TextToSpeech() {
  const [text, setText] = useState("");
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voice, setVoice] = useState("");
  const [rate, setRate] = useState(1);
  const [speaking, setSpeaking] = useState(false);
  const supported = typeof window !== "undefined" && "speechSynthesis" in window;

  useEffect(() => {
    if (!supported) return;
    const load = () => setVoices(window.speechSynthesis.getVoices().filter((v) => v.lang.startsWith("en")).concat(window.speechSynthesis.getVoices().filter((v) => !v.lang.startsWith("en"))));
    load();
    window.speechSynthesis.addEventListener("voiceschanged", load);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", load);
  }, [supported]);

  const speak = () => {
    if (!text.trim()) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const v = voices.find((x) => x.name === voice);
    if (v) u.voice = v;
    u.rate = rate;
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    setSpeaking(true);
    window.speechSynthesis.speak(u);
  };

  if (!supported) return <p className="rounded-control bg-warning-soft px-4 py-3 text-sm">This browser does not support speech synthesis. Try Chrome or Edge.</p>;
  return (
    <div className="space-y-4">
      <div><Label htmlFor="tts-text">Text to read aloud</Label><Textarea id="tts-text" value={text} onChange={(e) => setText(e.target.value)} className="min-h-[160px] font-sans" placeholder="Paste a client email, a report section, anything you want to hear read back." /></div>
      <div className="grid gap-4 sm:grid-cols-[1fr_160px]">
        <div><Label htmlFor="tts-voice">Voice</Label><Select id="tts-voice" value={voice} onChange={(e) => setVoice(e.target.value)}><option value="">Browser default</option>{voices.map((v) => <option key={v.name} value={v.name}>{v.name} ({v.lang})</option>)}</Select></div>
        <div><Label htmlFor="tts-rate">Speed <span className="font-mono text-xs text-accent">{rate.toFixed(1)}×</span></Label><input id="tts-rate" type="range" min={0.5} max={2} step={0.1} value={rate} onChange={(e) => setRate(Number(e.target.value))} className="h-11 w-full accent-[var(--indigo)]" /></div>
      </div>
      <div className="flex gap-2">
        {speaking ? <Button variant="secondary" onClick={() => { window.speechSynthesis.cancel(); setSpeaking(false); }}><Square className="h-4 w-4" /> Stop</Button> : <Button onClick={speak} disabled={!text.trim()}><Volume2 className="h-4 w-4" /> Read aloud</Button>}
      </div>
      <p className="text-xs text-muted">Voices come from your operating system. Audio download is not offered because browsers do not expose the synthesised audio; use your system&apos;s recorder if you need a file.</p>
    </div>
  );
}

type Recognition = { start: () => void; stop: () => void; continuous: boolean; interimResults: boolean; lang: string; onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null; onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null };

export function Dictation() {
  const [listening, setListening] = useState(false);
  const [finalText, setFinalText] = useState("");
  const [interim, setInterim] = useState("");
  const [lang, setLang] = useState("en-US");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<Recognition | null>(null);
  const Ctor = typeof window !== "undefined" ? ((window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition }).SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: new () => Recognition }).webkitSpeechRecognition) : undefined;

  const start = () => {
    if (!Ctor) return;
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = lang;
    rec.onresult = (e) => {
      let fin = "";
      let tmp = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) fin += r[0].transcript + " ";
        else tmp += r[0].transcript;
      }
      if (fin) setFinalText((t) => (t + fin).replace(/\s+/g, " "));
      setInterim(tmp);
    };
    rec.onerror = (e) => { setError(e.error === "not-allowed" ? "Microphone access was blocked. Allow it in the browser's site settings." : `Speech recognition error: ${e.error}`); setListening(false); };
    rec.onend = () => { setListening(false); setInterim(""); };
    recRef.current = rec;
    setError(null);
    rec.start();
    setListening(true);
  };
  const stop = () => { recRef.current?.stop(); setListening(false); };
  useEffect(() => () => recRef.current?.stop(), []);

  if (!Ctor) return <p className="rounded-control bg-warning-soft px-4 py-3 text-sm">This browser does not support speech recognition. Chrome and Edge do.</p>;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-48"><Label htmlFor="dict-lang">Language</Label><Select id="dict-lang" value={lang} onChange={(e) => setLang(e.target.value)} disabled={listening}><option value="en-US">English (US)</option><option value="en-GB">English (UK)</option><option value="en-IN">English (India)</option><option value="hi-IN">Hindi</option><option value="es-US">Spanish (US)</option><option value="fr-FR">French</option><option value="de-DE">German</option></Select></div>
        {listening ? <Button variant="danger" onClick={stop}><Square className="h-4 w-4" /> Stop</Button> : <Button onClick={start}><Mic className="h-4 w-4" /> Start dictating</Button>}
        {listening && <span className="flex items-center gap-2 text-sm text-muted"><span className="h-2.5 w-2.5 animate-pulse rounded-full bg-error" /> Listening…</span>}
      </div>
      <div className="min-h-[200px] rounded-control border border-border bg-surface p-4 text-[15px] leading-relaxed text-foreground">
        {finalText}<span className="text-muted">{interim}</span>
        {!finalText && !interim && <span className="text-muted/60">Your words appear here. Speak naturally; punctuation like &quot;comma&quot; and &quot;new line&quot; may be recognised depending on the browser.</span>}
      </div>
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" onClick={async () => { await navigator.clipboard.writeText(finalText); setCopied(true); setTimeout(() => setCopied(false), 1500); }} disabled={!finalText}>{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} {copied ? "Copied" : "Copy"}</Button>
        <Button variant="secondary" size="sm" onClick={() => downloadBlob(new Blob([finalText], { type: "text/plain" }), "dictation.txt")} disabled={!finalText}><Download className="h-4 w-4" /> Download .txt</Button>
        <Button variant="ghost" size="sm" onClick={() => { setFinalText(""); setInterim(""); }} disabled={!finalText && !interim}>Clear</Button>
      </div>
      {error && <p className="rounded-control-sm bg-error-soft px-3 py-2 text-sm">{error}</p>}
      <p className="text-xs text-muted">Recognition runs through the browser&apos;s speech service (Chrome and Edge send audio to Google or Microsoft for transcription). Do not dictate confidential client details if that is a concern.</p>
    </div>
  );
}
