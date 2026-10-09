import "server-only";
import { resolve4, resolve6, resolveMx, resolveTxt, resolveNs, resolveCname } from "node:dns/promises";
import tls from "node:tls";
import { env } from "./env";
import { safeFetch, parseTarget, assertPublicHost, SsrfError } from "./ssrf";

type Result = { data?: unknown; text?: string; stats?: Record<string, string> };

const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ");
const attr = (tag: string, name: string) => tag.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`, "i"))?.[1] ?? tag.match(new RegExp(`${name}\\s*=\\s*'([^']*)'`, "i"))?.[1];

function fetchOpts(extra: Partial<Parameters<typeof safeFetch>[1]> = {}) {
  return { timeoutMs: env.webFetchTimeoutMs, maxBytes: env.webMaxBytes, ...extra };
}

function metaTags(html: string) {
  const tags: Record<string, string> = {};
  for (const m of html.matchAll(/<meta\s[^>]*>/gi)) {
    const t = m[0];
    const key = attr(t, "property") ?? attr(t, "name") ?? attr(t, "http-equiv");
    const content = attr(t, "content");
    if (key && content != null) tags[key.toLowerCase()] = decode(content);
  }
  return tags;
}

function stripHtml(html: string): string {
  let s = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>|<!--[\s\S]*?-->/gi, "");
  const main = s.match(/<main[\s\S]*?<\/main>/i)?.[0] ?? s.match(/<article[\s\S]*?<\/article>/i)?.[0];
  if (main && main.length > 500) s = main;
  s = s.replace(/<(br|\/p|\/div|\/h[1-6]|\/li|\/tr|\/section|\/article|\/header|\/footer)[^>]*>/gi, "\n");
  s = s.replace(/<[^>]+>/g, " ");
  return decode(s).replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function htmlToMarkdown(html: string): string {
  let s = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>|<!--[\s\S]*?-->|<nav[\s\S]*?<\/nav>|<footer[\s\S]*?<\/footer>/gi, "");
  const main = s.match(/<main[\s\S]*?<\/main>/i)?.[0] ?? s.match(/<article[\s\S]*?<\/article>/i)?.[0];
  if (main && main.length > 500) s = main;
  s = s.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, n, t) => `\n${"#".repeat(Number(n))} ${stripHtml(t)}\n\n`);
  s = s.replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, "**$2**").replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, "*$2*");
  s = s.replace(/<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, h, t) => `[${stripHtml(t)}](${h})`);
  s = s.replace(/<img\s[^>]*alt="([^"]*)"[^>]*src="([^"]*)"[^>]*>/gi, "![$1]($2)");
  s = s.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, t) => `- ${stripHtml(t)}\n`);
  s = s.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_, t) => `\n\`\`\`\n${stripHtml(t)}\n\`\`\`\n`);
  s = s.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, "`$1`");
  s = s.replace(/<\/(p|div|tr|ul|ol|blockquote)>/gi, "\n\n").replace(/<\/t[dh]>/gi, " | ");
  return stripHtml(s).replace(/\n{3,}/g, "\n\n").trim();
}

export const actions: Record<string, (target: string, options: Record<string, unknown>) => Promise<Result>> = {
  async headers(target) {
    const { response, finalUrl, timeMs } = await safeFetch(target, fetchOpts({ method: "HEAD", maxBytes: 1024 }));
    const headers: Record<string, string> = {};
    response.headers.forEach((v, k) => (headers[k] = v));
    return { data: { url: finalUrl, status: response.status, statusText: response.statusText, headers }, stats: { Status: String(response.status), Time: `${timeMs} ms`, Server: headers.server ?? "?" } };
  },

  async dns(target) {
    const host = parseTarget(target).hostname;
    await assertPublicHost(host);
    const safe = async <T>(p: Promise<T>): Promise<T | string> => p.catch((e: Error) => (e as NodeJS.ErrnoException).code ?? "none");
    const [a, aaaa, mx, txt, ns, cname] = await Promise.all([safe(resolve4(host)), safe(resolve6(host)), safe(resolveMx(host)), safe(resolveTxt(host)), safe(resolveNs(host)), safe(resolveCname(host))]);
    return { data: { host, A: a, AAAA: aaaa, MX: mx, TXT: Array.isArray(txt) ? txt.map((t) => t.join("")) : txt, NS: ns, CNAME: cname }, stats: { Host: host, "A records": Array.isArray(a) ? String(a.length) : "0" } };
  },

  async ssl(target) {
    const u = parseTarget(target);
    const host = u.hostname;
    await assertPublicHost(host);
    const port = Number(u.port) || 443;
    const cert = await new Promise<tls.PeerCertificate>((resolve, reject) => {
      const socket = tls.connect({ host, port, servername: host, timeout: env.webFetchTimeoutMs, rejectUnauthorized: false }, () => {
        const c = socket.getPeerCertificate();
        const authorized = socket.authorized;
        socket.end();
        resolve({ ...c, authorized } as tls.PeerCertificate & { authorized: boolean });
      });
      socket.on("error", (e) => reject(new SsrfError("TLS connection failed", e.message)));
      socket.on("timeout", () => { socket.destroy(); reject(new SsrfError("TLS connection timed out")); });
    });
    const c = cert as tls.PeerCertificate & { authorized?: boolean };
    const daysLeft = Math.round((new Date(c.valid_to).getTime() - Date.now()) / 86400000);
    return {
      data: { host, subject: c.subject, issuer: c.issuer, validFrom: c.valid_from, validTo: c.valid_to, daysLeft, serialNumber: c.serialNumber, fingerprint256: c.fingerprint256, subjectAltNames: c.subjectaltname?.split(", ").map((s) => s.replace(/^DNS:/, "")) ?? [], trusted: c.authorized },
      stats: { Issuer: String(c.issuer?.O ?? c.issuer?.CN ?? "?"), Expires: c.valid_to, "Days left": String(daysLeft), Trusted: c.authorized ? "Yes" : "No" },
    };
  },

  async robots(target) {
    const u = parseTarget(target);
    const { body, response } = await safeFetch(`${u.origin}/robots.txt`, fetchOpts());
    if (response.status >= 400) throw new SsrfError(`No robots.txt (HTTP ${response.status})`);
    const sitemaps = [...body.matchAll(/^sitemap:\s*(\S+)/gim)].map((m) => m[1]);
    return { text: body, data: { sitemaps }, stats: { Lines: String(body.split("\n").length), Sitemaps: String(sitemaps.length) } };
  },

  async sitemap(target) {
    const u = parseTarget(target);
    const url = /sitemap/i.test(u.pathname) ? u.href : `${u.origin}/sitemap.xml`;
    const { body } = await safeFetch(url, fetchOpts({ maxBytes: 5 * 1024 * 1024 }));
    const locs = [...body.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)].map((m) => decode(m[1]));
    const isIndex = /<sitemapindex/i.test(body);
    let urls = locs;
    if (isIndex) {
      urls = [];
      for (const child of locs.slice(0, 10)) {
        try {
          const { body: cb } = await safeFetch(child, fetchOpts({ maxBytes: 5 * 1024 * 1024 }));
          urls.push(...[...cb.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)].map((m) => decode(m[1])));
        } catch { /* skip broken child */ }
      }
    }
    return { text: urls.join("\n"), data: { source: url, isIndex, childSitemaps: isIndex ? locs : [], urls }, stats: { URLs: String(urls.length), Type: isIndex ? "Sitemap index" : "URL set" } };
  },

  async og(target) {
    const { body, finalUrl } = await safeFetch(target, fetchOpts());
    const m = metaTags(body);
    const title = m["og:title"] ?? body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim();
    const data = { url: finalUrl, title: title ? decode(title) : null, description: m["og:description"] ?? m.description ?? null, image: m["og:image"] ?? m["twitter:image"] ?? null, siteName: m["og:site_name"] ?? null, type: m["og:type"] ?? null, twitterCard: m["twitter:card"] ?? null };
    return { data, stats: { Title: data.title ?? "(none)", Image: data.image ? "Yes" : "No" } };
  },

  async meta(target) {
    const { body, finalUrl, response } = await safeFetch(target, fetchOpts());
    const m = metaTags(body);
    const title = body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim();
    const canonical = [...body.matchAll(/<link\s[^>]*>/gi)].map((x) => x[0]).find((t) => /rel\s*=\s*["']canonical["']/i.test(t));
    const h1 = [...body.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)].map((x) => stripHtml(x[1])).slice(0, 5);
    const data = { url: finalUrl, status: response.status, title: title ? decode(title) : null, titleLength: title?.length ?? 0, description: m.description ?? null, descriptionLength: m.description?.length ?? 0, canonical: canonical ? attr(canonical, "href") : null, robots: m.robots ?? null, viewport: m.viewport ?? null, lang: body.match(/<html[^>]*lang="([^"]+)"/i)?.[1] ?? null, h1, metaTags: m };
    return { data, stats: { Title: `${data.titleLength} chars`, Description: `${data.descriptionLength} chars`, Canonical: data.canonical ? "Yes" : "No" } };
  },

  async favicon(target) {
    const { body, finalUrl } = await safeFetch(target, fetchOpts());
    const base = new URL(finalUrl);
    const links = [...body.matchAll(/<link\s[^>]*>/gi)].map((x) => x[0]).filter((t) => /rel\s*=\s*["'][^"']*icon[^"']*["']/i.test(t));
    const icons = links.map((t) => ({ rel: attr(t, "rel"), href: attr(t, "href") ? new URL(attr(t, "href")!, base).href : null, sizes: attr(t, "sizes") ?? null, type: attr(t, "type") ?? null })).filter((i) => i.href);
    if (!icons.some((i) => i.href?.endsWith("/favicon.ico"))) icons.push({ rel: "default", href: `${base.origin}/favicon.ico`, sizes: null, type: null });
    const checked = [];
    for (const i of icons.slice(0, 10)) {
      try {
        const { response } = await safeFetch(i.href!, fetchOpts({ method: "HEAD", maxBytes: 1024 }));
        checked.push({ ...i, status: response.status, ok: response.ok, contentType: response.headers.get("content-type") });
      } catch (e) {
        checked.push({ ...i, status: 0, ok: false, error: e instanceof Error ? e.message : "failed" });
      }
    }
    return { data: checked, stats: { Declared: String(icons.length), Resolving: String(checked.filter((c) => c.ok).length) } };
  },

  async toText(target) {
    const { body, finalUrl, truncated } = await safeFetch(target, fetchOpts());
    const text = stripHtml(body);
    return { text, data: { url: finalUrl, truncated }, stats: { Characters: text.length.toLocaleString(), Words: String(text.split(/\s+/).filter(Boolean).length) } };
  },

  async toMarkdown(target) {
    const { body, finalUrl, truncated } = await safeFetch(target, fetchOpts());
    const title = body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim();
    const md = `${title ? `# ${decode(title)}\n\n` : ""}${htmlToMarkdown(body)}`;
    return { text: md, data: { url: finalUrl, truncated }, stats: { Characters: md.length.toLocaleString() } };
  },

  async request(target, options) {
    const method = String(options.method ?? "GET").toUpperCase();
    if (!["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"].includes(method)) throw new SsrfError("Unsupported method");
    const headers = (options.headers ?? {}) as Record<string, string>;
    const body = ["GET", "HEAD"].includes(method) ? undefined : String(options.body ?? "") || undefined;
    const { response, body: text, timeMs, finalUrl, truncated } = await safeFetch(target, fetchOpts({ method, headers, body }));
    const h: Record<string, string> = {};
    response.headers.forEach((v, k) => (h[k] = v));
    return { data: { url: finalUrl, status: response.status, statusText: response.statusText, headers: h, body: text, timeMs, truncated } };
  },
};
