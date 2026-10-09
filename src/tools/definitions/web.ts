import type { ToolDefinition } from "@/types/tool";

const urlTool = (
  id: string,
  name: string,
  description: string,
  keywords: string[],
  processor: string,
  icon: string,
  extra: Partial<ToolDefinition> = {},
): ToolDefinition => ({
  id,
  name,
  category: "web",
  description,
  keywords,
  input: [],
  output: ["json"],
  processor,
  kind: "text",
  status: "ready",
  runtime: "server",
  icon,
  inputLabel: "URL",
  inputPlaceholder: "https://example.com",
  ...extra,
});

export const webTools: ToolDefinition[] = [
  urlTool("url-parser", "URL parser", "Break a URL into protocol, host, path, query parameters and hash.", ["url", "parse", "query string", "params"], "web.parseUrl", "Link", { runtime: "browser" }),
  urlTool("http-headers", "HTTP header viewer", "Fetch a URL and show the response status and headers.", ["headers", "http", "response", "status"], "web.headers", "ListOrdered"),
  urlTool("dns-lookup", "DNS lookup", "A, AAAA, MX, TXT, NS and CNAME records for a host.", ["dns", "records", "mx", "txt", "nameserver"], "web.dns", "Network", { inputLabel: "Host name", inputPlaceholder: "omnifi.co" }),
  urlTool("ssl-viewer", "SSL certificate viewer", "Issuer, subject, validity dates and SANs of a site's certificate.", ["ssl", "tls", "certificate", "https", "expiry"], "web.ssl", "ShieldCheck", { inputLabel: "Host name", inputPlaceholder: "omnifi.co" }),
  urlTool("robots-viewer", "Robots.txt viewer", "Fetch and display a site's robots.txt.", ["robots", "crawl", "seo"], "web.robots", "Bot"),
  urlTool("sitemap-parser", "Sitemap parser", "List the URLs in a sitemap.xml (follows sitemap indexes one level).", ["sitemap", "seo", "urls"], "web.sitemap", "Map", { inputPlaceholder: "https://example.com/sitemap.xml" }),
  urlTool("og-preview", "Open Graph preview", "See how a link will unfurl: title, description and image.", ["open graph", "og", "preview", "unfurl", "social card"], "web.og", "Share2"),
  urlTool("metadata-checker", "Metadata checker", "Title, description, canonical, robots and all meta tags on a page.", ["meta tags", "seo", "canonical", "title"], "web.meta", "SearchCheck"),
  urlTool("favicon-checker", "Favicon checker", "Find the icons a page declares and whether they resolve.", ["favicon", "icon", "check"], "web.favicon", "AppWindow"),
  urlTool("website-to-text", "Website to text", "Fetch a public page and strip it to readable text.", ["website", "text", "extract", "scrape", "readable"], "web.toText", "FileText", { output: ["txt"] }),
  urlTool("website-to-markdown", "Website to Markdown", "Fetch a public page and convert its main content to Markdown.", ["website", "markdown", "convert"], "web.toMarkdown", "FileCode", { output: ["md"] }),
  urlTool("website-screenshot", "Website screenshot", "Capture a page as an image.", ["screenshot", "capture"], "server.screenshot", "Camera", { status: "coming-soon", output: ["png"] }),
  urlTool("html-to-pdf", "HTML to PDF", "Render a page or HTML to PDF.", ["html to pdf", "print"], "server.htmlToPdf", "FileType", { status: "coming-soon", output: ["pdf"] }),
];
