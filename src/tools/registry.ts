import type { ToolCategoryId, ToolDefinition } from "@/types/tool";
import { categories } from "./categories";
import { mimeForExt } from "@/lib/files";
import { documentTools } from "./definitions/documents";
import { imageTools } from "./definitions/images";
import { mediaTools } from "./definitions/media";
import { officeTools } from "./definitions/office";
import { financeTools } from "./definitions/finance";
import { developerTools } from "./definitions/developer";
import { webTools } from "./definitions/web";
import { fileTools } from "./definitions/files";
import { textTools } from "./definitions/text";
import { aiTools } from "./definitions/ai";
import { utilityTools } from "./definitions/utilities";

/**
 * Central tool registry. Every tool in the platform is declared here.
 * This powers search, categories, favorites, recents, related tools and the
 * workflow builder. To add a tool see docs/ADDING_A_TOOL.md.
 */
export const tools: ToolDefinition[] = [
  ...documentTools,
  ...imageTools,
  ...mediaTools,
  ...officeTools,
  ...financeTools,
  ...developerTools,
  ...webTools,
  ...fileTools,
  ...textTools,
  ...utilityTools,
  ...aiTools,
];

const byId = new Map(tools.map((t) => [t.id, t]));

// Fail fast on duplicate ids so a bad registry never ships.
if (byId.size !== tools.length) {
  const seen = new Set<string>();
  const dupes = tools.map((t) => t.id).filter((id) => (seen.has(id) ? true : (seen.add(id), false)));
  throw new Error(`Duplicate tool ids in registry: ${dupes.join(", ")}`);
}

export function getTool(id: string): ToolDefinition | undefined {
  return byId.get(id);
}

export function toolsInCategory(category: ToolCategoryId, includeComingSoon = true): ToolDefinition[] {
  return tools.filter((t) => t.category === category && (includeComingSoon || t.status === "ready"));
}

export function readyTools(): ToolDefinition[] {
  return tools.filter((t) => t.status === "ready");
}

export function relatedTools(tool: ToolDefinition, limit = 6): ToolDefinition[] {
  const explicit = (tool.related ?? []).map((id) => byId.get(id)).filter(Boolean) as ToolDefinition[];
  const sameCategory = tools.filter(
    (t) => t.category === tool.category && t.id !== tool.id && t.status === "ready" && !explicit.includes(t),
  );
  return [...explicit, ...sameCategory].slice(0, limit);
}

/** Does a tool accept files of this format? `format` may be an extension ("jpg") or a MIME type. */
export function accepts(tool: ToolDefinition, format: string): boolean {
  const f = format.toLowerCase();
  const mime = f.includes("/") ? f : mimeForExt(f);
  return tool.input.some((i) => {
    const rule = i.toLowerCase();
    if (rule === "*") return true;
    if (rule.endsWith("/*")) return mime.startsWith(rule.slice(0, -1));
    if (rule.includes("/")) return rule === mime;
    return rule === f || mimeForExt(rule) === mime;
  });
}

/** Tools that can consume the given output format (for workflow chaining). */
export function toolsAccepting(format: string): ToolDefinition[] {
  return tools.filter((t) => t.status === "ready" && t.chainable && t.kind === "file" && accepts(t, format));
}

export const registryStats = () => ({
  total: tools.length,
  ready: tools.filter((t) => t.status === "ready").length,
  comingSoon: tools.filter((t) => t.status === "coming-soon").length,
  categories: categories.length,
});

export { categories };
