/**
 * Omnifi brand tokens.
 * Source of truth: docs/OMNIFI_BRAND_GUIDE.md (derived from the Omnifi brand
 * assistant skill, omnifi_theme.json and omnifi-landing.html).
 * Do not invent new brand colours here.
 */
export const brand = {
  name: "Omnifi",
  product: "SuperTools",
  tagline: "One place for the tools you actually need.",
  colors: {
    navy900: "#070B2E",
    navy800: "#0A0F3D", // Deep Navy: primary dark background
    navy600: "#131A6B", // Mid Navy: secondary dark surface
    indigo: "#4F5BD5", // Indigo Bright: primary accent, links, KPI numbers
    lavender: "#8B91E3", // Subtitles on dark backgrounds
    green: "#00C48C", // Accent Green: growth / positive metrics ONLY
    paper: "#F5F5FA", // Off-White: light backgrounds, table rows
    bodyNavy: "#2D3580", // Body text on light backgrounds
    mutedIndigo: "#6B72B8", // Muted / secondary text
    border: "#E3E5F0",
    warning: "#D98E04", // functional only (omnifi_theme.json "neutral")
    error: "#E53935", // functional only, never decorative
    logoNavy: "#0F105E", // colour baked into the official logo SVG
    logoPurple: "#6B6BFD", // colour baked into the official logo SVG
  },
  radius: { control: "14px", motif: "24px" },
  logo: { src: "/branding/omnifi-logo.svg", width: 160, height: 43 },
} as const;
