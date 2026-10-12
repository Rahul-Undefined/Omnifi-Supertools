import type { CalcProcessor } from "@/types/processor";
import { ProcessorError } from "@/types/processor";

/**
 * "custom" tools are fully interactive pages rendered by a React component
 * (see src/components/custom). They have no batch processor; this stub keeps
 * the registry contract (every ready tool resolves to a processor family).
 */
const interactive = (name: string): CalcProcessor => async () => {
  throw new ProcessorError(`${name} is an interactive tool`, "Open it from the Tools page.");
};

export const typing = interactive("Typing test");
export const organize = interactive("Page organiser");
export const redact = interactive("Redact PDF");
export const fillForm = interactive("Fill PDF form");
export const invoice = interactive("Invoice generator");
export const tts = interactive("Text to speech");
export const dictation = interactive("Dictation");
export const stepsRecorder = interactive("Steps Recorder");
export const videoDownloader = interactive("Video downloader");
