export const site = {
  name: "Omnifi SuperTools",
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
    { href: "/ai", label: "AI" },
    { href: "/feedback", label: "Ideas" },
    { href: "https://extropyadvind.sharepoint.com/sites/OmnifiTechHub", label: "Tech Hub", external: true },
  ],
  /** Shown in the account menu (and the mobile menu). Admin only for admins. */
  userNav: [
    { href: "/favorites", label: "Favorites" },
    { href: "/recent", label: "Recently used" },
    { href: "/downloads", label: "Downloads" },
    { href: "/admin", label: "Admin", adminOnly: true },
  ],
  links: {
    website: "https://www.myomnifi.com/",
    techHub: "https://extropyadvind.sharepoint.com/sites/OmnifiTechHub",
    stepsRecorder: "/downloads/Omnifi-Steps-Recorder.zip",
  },
  support: { name: "Rahul Ojha", email: "rahul@myomnifi.com" },
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
