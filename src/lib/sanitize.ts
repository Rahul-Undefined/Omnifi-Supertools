import type { DOMPurify, Config } from "dompurify";

/**
 * HTML sanitiser for rendered previews (Markdown preview, HTML outputs).
 * Allowlist-based (DOMPurify) so only known-safe markup survives: no scripts,
 * event handlers, SVG/MathML, forms, iframes, objects, dangerous URL schemes,
 * or inline CSS. The result is additionally shown inside a sandboxed iframe
 * by the UI, so even a sanitiser bypass cannot run in the app's origin.
 */

export const SANITIZE_CONFIG = {
  USE_PROFILES: { html: true },
  ALLOWED_TAGS: [
    "a", "abbr", "b", "blockquote", "br", "caption", "code", "col", "colgroup", "dd", "del", "details", "div", "dl", "dt", "em", "figcaption", "figure",
    "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "img", "ins", "kbd", "li", "mark", "ol", "p", "pre", "q", "s", "small", "span", "strong", "sub", "summary", "sup",
    "table", "tbody", "td", "tfoot", "th", "thead", "tr", "u", "ul",
  ],
  ALLOWED_ATTR: ["href", "title", "alt", "src", "width", "height", "colspan", "rowspan", "align", "start", "type", "lang", "dir", "id", "class"],
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
  FORBID_TAGS: ["style", "script", "iframe", "object", "embed", "form", "input", "button", "textarea", "select", "svg", "math", "link", "meta", "base", "template", "slot", "video", "audio", "source", "track", "noscript"],
  FORBID_ATTR: ["style", "srcset", "formaction", "xlink:href", "action", "background", "poster", "ping", "target"],
  ALLOW_DATA_ATTR: false,
  ALLOW_ARIA_ATTR: false,
  KEEP_CONTENT: true,
  RETURN_TRUSTED_TYPE: false,
  WHOLE_DOCUMENT: false,
  SANITIZE_DOM: true,
  SAFE_FOR_TEMPLATES: false,
};

/** Hook: images may only come from https/data URLs, links get safe rel. */
function hardenNode(node: Element) {
  if (node.tagName === "IMG") {
    const src = node.getAttribute("src") ?? "";
    if (!/^(https?:|data:image\/(?:png|jpeg|gif|webp);base64,)/i.test(src)) node.removeAttribute("src");
  }
  if (node.tagName === "A") {
    node.setAttribute("rel", "noopener noreferrer nofollow");
    node.setAttribute("target", "_blank");
  }
}

let hooked: WeakSet<object> | null = null;

/** Sanitize with a DOMPurify instance (window-bound in the browser, jsdom-bound in tests). */
export function sanitizeHtml(html: string, purifier: DOMPurify): string {
  if (!hooked) hooked = new WeakSet();
  if (!hooked.has(purifier)) {
    purifier.addHook("afterSanitizeAttributes", (node: Element) => hardenNode(node));
    hooked.add(purifier);
  }
  return purifier.sanitize(html ?? "", SANITIZE_CONFIG as Config) as string;
}

/** Minimal stylesheet for the sandboxed preview frame (no external resources). */
export const PREVIEW_CSS = `
  :root { color-scheme: light dark; }
  body { margin: 0; padding: 16px; font: 14px/1.6 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #1F2340; background: #fff; word-wrap: break-word; }
  @media (prefers-color-scheme: dark) { body { color: #E6E8F5; background: #0E1247; } a { color: #9AA3F0; } }
  h1, h2, h3 { color: inherit; line-height: 1.25; margin: 1.2em 0 .5em; } h1 { font-size: 1.6em; } h2 { font-size: 1.3em; } h3 { font-size: 1.1em; }
  a { color: #4F5BD5; } pre { background: rgba(127,127,160,.12); padding: 10px 12px; border-radius: 8px; overflow: auto; } code { font-family: ui-monospace, Consolas, monospace; font-size: .92em; }
  table { border-collapse: collapse; width: 100%; margin: 1em 0; } th, td { border: 1px solid rgba(127,127,160,.35); padding: 6px 8px; text-align: left; } th { background: rgba(127,127,160,.12); }
  img { max-width: 100%; height: auto; } blockquote { border-left: 3px solid #4F5BD5; margin: 1em 0; padding: .2em 1em; opacity: .9; }
`;

/** Full document for an iframe srcdoc: sanitised body plus the preview stylesheet. The frame CSP forbids everything but inline styles. */
export function previewDocument(sanitizedBody: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><style>${PREVIEW_CSS}</style></head><body>${sanitizedBody}</body></html>`;
}
