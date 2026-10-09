export const site = {
  name: "OmniFi SuperTools",
  shortName: "SuperTools",
  description:
    "Convert, edit, analyze, automate and transform your files without jumping between dozens of websites.",
  headline: "Everything you need. One toolbox.",
  searchPlaceholder: "What do you want to do?",
  searchExamples: [
    "Compress a PDF",
    "Convert Excel to CSV",
    "Extract text from a scanned document",
    "Convert MP4 to MP3",
    "Compare two Excel files",
    "Generate a QR code",
    "Convert 2 PM IST to EST",
  ],
  nav: [
    { href: "/", label: "Home" },
    { href: "/tools", label: "Tools" },
    { href: "/workflows", label: "Workflows" },
    { href: "/favorites", label: "Favorites" },
    { href: "/recent", label: "Recent" },
    { href: "/ai", label: "AI" },
    { href: "/feedback", label: "Ideas" },
    { href: "/admin", label: "Admin", adminOnly: true },
  ],
  limits: {
    /** Max size per file for browser-side tools (bytes). */
    browserFileBytes: 500 * 1024 * 1024,
    /** Max size per upload for server-side tools (bytes). */
    serverFileBytes: 100 * 1024 * 1024,
    /** Max files per batch. */
    batchFiles: 200,
  },
  shortcuts: [
    { keys: "Ctrl + K", action: "Open command palette / search tools" },
    { keys: "Ctrl + /", action: "Focus search" },
    { keys: "Esc", action: "Close modal or palette" },
    { keys: "Ctrl + Enter", action: "Run the current tool" },
    { keys: "F", action: "Toggle favorite on a tool page" },
  ],
} as const;
