import type { ToolDefinition } from "@/types/tool";
import { ZONE_OPTIONS } from "@/processors/utilities/timezones";

const zoneSelect = ZONE_OPTIONS.map(([value, label]) => ({ value, label }));

const CURRENCIES = ["USD", "INR", "EUR", "GBP", "AED", "CAD", "AUD", "SGD", "JPY", "CNY", "HKD", "CHF", "SAR", "QAR", "KWD", "MYR", "THB", "PHP", "IDR", "VND", "KRW", "NZD", "ZAR", "NGN", "KES", "EGP", "TRY", "BRL", "MXN", "ARS", "CLP", "COP", "PLN", "SEK", "NOK", "DKK", "CZK", "HUF", "ILS", "PKR", "BDT", "LKR", "NPR"];

export const utilityTools: ToolDefinition[] = [
  {
    id: "timezone-converter",
    name: "Time zone converter",
    category: "utilities",
    description: "Convert a time from one zone to many at once. IST to EST, PST to CET, and any IANA zone.",
    keywords: ["time zone", "timezone", "ist", "est", "pst", "cst", "gmt", "utc", "convert time", "ist to est", "india time", "meeting time"],
    input: [],
    output: ["txt"],
    processor: "utilities.timezone",
    kind: "calculator",
    status: "ready",
    runtime: "browser",
    icon: "Clock",
    options: [
      { type: "text", key: "datetime", label: "Date and time (blank = now)", default: "", placeholder: "2026-03-01 14:30, 03/01/2026 2:30 PM, or 14:30" },
      { type: "select", key: "from", label: "From zone", default: "Asia/Kolkata", options: zoneSelect },
      { type: "text", key: "fromCustom", label: "Or type a zone / abbreviation", default: "", placeholder: "IST, EST, Europe/Berlin…" },
      { type: "textarea", key: "to", label: "To zones (comma separated; abbreviations work)", default: "EST, CST, PST, GMT, CET, Asia/Dubai, Asia/Singapore, Australia/Sydney" },
    ],
    related: ["world-clock", "timestamp-converter"],
  },
  {
    id: "world-clock",
    name: "World clock",
    category: "utilities",
    description: "Current time across the zones you care about.",
    keywords: ["world clock", "current time", "time now", "zones"],
    input: [],
    output: ["txt"],
    processor: "utilities.worldClock",
    kind: "generator",
    status: "ready",
    runtime: "browser",
    icon: "Globe2",
    options: [{ type: "textarea", key: "zones", label: "Zones (blank = OmniFi defaults)", default: "" }],
    related: ["timezone-converter"],
  },
  {
    id: "currency-converter",
    name: "Currency converter (live)",
    category: "utilities",
    description: "Convert between 160+ currencies with rates refreshed daily from a public rate feed.",
    keywords: ["currency", "exchange rate", "forex", "usd to inr", "inr to usd", "convert money", "eur", "gbp", "aed", "live rates"],
    input: [],
    output: ["txt"],
    processor: "utilities.currency",
    kind: "calculator",
    status: "ready",
    runtime: "server",
    icon: "Coins",
    options: [
      { type: "number", key: "amount", label: "Amount", default: 1000, min: 0, step: 0.01 },
      { type: "select", key: "from", label: "From", default: "USD", options: CURRENCIES.map((c) => ({ value: c, label: c })) },
      { type: "text", key: "fromCustom", label: "Or type a currency code", default: "", placeholder: "e.g. OMR" },
      { type: "text", key: "to", label: "To (comma separated)", default: "INR, EUR, GBP, AED, CAD" },
    ],
    related: ["gst-calculator", "percentage-calculator"],
  },
];
