# Omnifi brand guide (as applied in SuperTools)

This document records the branding system discovered in existing Omnifi materials and how SuperTools applies it. Nothing here was invented; every value traces to an existing Omnifi asset.

## Sources found

| Asset | Location | Used for |
|---|---|---|
| Official logo (SVG) | `Downloads/Omnifi_Internal/Omnifi/omnifi-logo-main.svg` | Copied unmodified to `public/branding/omnifi-logo.svg` |
| Omnifi brand assistant skill | Claude skill `omnifi-brand-assistant` | Colour system, typography rules, voice, visual rules |
| Older brand skill package | `Downloads/Omnifi_Internal/General_Company_Admin/omnifi-brand.skill` | Logo anatomy, earlier palette (superseded, see notes) |
| Power BI theme | `Downloads/PowerBi/Docs/source/omnifi_theme.json` | Surface/border/table colours, functional colours |
| Landing page | `Downloads/Omnifi_Internal/Omnifi/omnifi-landing.html` | Radius, motion, font choice (Geist), dark-surface treatment |

## Colour system

| Role | Name | Hex | SuperTools token |
|---|---|---|---|
| Primary background (dark) | Deep Navy | `#0A0F3D` | `--navy-800` |
| Secondary dark surface | Mid Navy | `#131A6B` | `--navy-600` |
| Darkest backdrop | Navy 900 | `#070B2E` | `--navy-900` |
| Primary accent, links, KPI numbers | Indigo Bright | `#4F5BD5` | `--indigo`, `--accent` |
| Accent hover | | `#5F6AE0` | `--indigo-hover` |
| Subtitles on dark | Lavender | `#8B91E3` | `--lavender` |
| Growth / positive ONLY | Accent Green | `#00C48C` | `--green`, `--success` |
| Light backgrounds, table rows | Off-White | `#F5F5FA` | `--paper` |
| Body text on light | Body Navy | `#2D3580` | `--body-navy` |
| Muted / secondary text | Muted Indigo | `#6B72B8` | `--muted-indigo` |
| Borders | | `#E3E5F0` | `--border` |
| Warning (functional only) | | `#D98E04` | `--warning` |
| Error (functional only) | | `#E53935` | `--error` |

Colours baked into the official logo file and never changed: navy `#0F105E` and purple `#6B6BFD`.

### Forbidden

- Yellow, pink and red as decoration. Red is functional only (errors, negative variance).
- Random floating coloured dots.
- Gradient text.
- Mixing green and indigo for the same data category.

### Note on the two palettes

The older `omnifi-brand.skill` package lists a wider palette (pink `#F91149`, yellow `#FEC703`, Montserrat) and decorative dots. The current brand assistant skill, the Power BI theme and the landing page all use the restrained navy/indigo system and explicitly forbid decorative colours. SuperTools follows the current system. The logo file itself is shared by both.

## Typography

- Family: Geist (as used by the Omnifi landing page), with JetBrains Mono / Geist Mono for numerals and code. System fallback: Segoe UI.
- Headlines: semibold (600), tight letter-spacing, sentence case.
- Body: regular (400). Never ALL CAPS body text.
- Brand dot: key headlines end with a period in Indigo Bright (`.brand-dot`).

## Shape, elevation, motion

- Border radius: 14 px on controls and cards (`--radius`), 24 px for the rounded-square motif (`--radius-motif`).
- Rounded-square motif: outlined square, top-right of dark hero areas only. Used once per dark section.
- Shadows: soft navy-tinted (`--shadow-sm/md/lg`). No hard drop shadows.
- Motion: 200 to 350 ms with `cubic-bezier(.16,1,.3,1)`. Hover lifts cards 2 px. Everything collapses under `prefers-reduced-motion`.

## Logo usage

- `omnifi-logo.svg` on light surfaces, `omnifi-logo-white.svg` (navy paths turned white, purple untouched) on dark surfaces.
- Header: small, top-left, followed by a thin divider and the product name "SuperTools".
- Login, error and empty states: larger, centred.
- Favicon: the "Ö" mark alone (`favicon.svg`), extracted from the official file.
- Never stretch, recolour the purple, or add effects.

## Light and dark mode

| Token | Light | Dark |
|---|---|---|
| Background | `#FFFFFF` | `#0A0F3D` |
| Surface | `#FFFFFF` | `#0F1550` |
| Surface 2 | `#F5F5FA` | `#131A6B` |
| Text | `#0A0F3D` | `#F5F5FA` |
| Body text | `#2D3580` | `#C9CCF0` |
| Muted | `#6B72B8` | `#9AA0D8` |
| Border | `#E3E5F0` | `rgba(139,145,227,.2)` |

Theme choice (light, dark, system) persists per user in local storage.

## Voice (microcopy)

Authoritative, precise, active voice, no filler. "Drop your file here", "Done", "Something went wrong. Try again." Forbidden words: leverage, synergy, cutting-edge, best-in-class, holistic, seamlessly, innovative solutions, dynamic, robust.
