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
