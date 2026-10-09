import type { AnyProcessor } from "@/types/processor";

type Loader = () => Promise<Record<string, unknown>>;

/**
 * Processor id -> lazy module. Each family is code-split so a user who opens
 * the JSON formatter never downloads pdf.js or FFmpeg.
 * A processor id is "<family>.<name>" and resolves to the named export.
 */
const families: Record<string, Loader> = {
  pdf: () => import("./pdf"),
  image: () => import("./image"),
  media: () => import("./media"),
  office: () => import("./office"),
  finance: () => import("./finance"),
  dev: () => import("./dev"),
  text: () => import("./text"),
  file: () => import("./file"),
  web: () => import("./web"),
  utilities: () => import("./utilities"),
  custom: () => import("./custom"),
  insights: () => import("./insights"),
  ai: () => import("./ai"),
};

const cache = new Map<string, Promise<Record<string, unknown>>>();

export async function resolveProcessor(id: string): Promise<AnyProcessor> {
  const [family, name] = id.split(".");
  const loader = families[family];
  if (!loader) throw new Error(`Unknown processor family "${family}"`);
  let mod = cache.get(family);
  if (!mod) {
    mod = loader();
    cache.set(family, mod);
  }
  const m = await mod;
  const fn = m[name];
  if (typeof fn !== "function") throw new Error(`Processor "${id}" is not implemented`);
  return fn as AnyProcessor;
}

export function isImplemented(id: string): boolean {
  const [family] = id.split(".");
  return family in families;
}
