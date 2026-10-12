import type { ToolCategory, ToolCategoryId } from "@/types/tool";

export const categories: ToolCategory[] = [
  { id: "documents", name: "Documents", description: "Merge, split, compress, convert and read PDFs.", icon: "FileText" },
  { id: "images", name: "Images", description: "Compress, resize, convert and generate images and codes.", icon: "Image" },
  { id: "media", name: "Video & Audio", description: "Convert, trim and extract audio and video.", icon: "Clapperboard" },
  { id: "office", name: "Excel & CSV", description: "Spreadsheet clean-up, consolidation, formulas and conversions.", icon: "Table" },
  { id: "powerpoint", name: "PowerPoint", description: "Merge, split, clean, compress, extract and generate decks.", icon: "Presentation" },
  { id: "word", name: "Word", description: "Merge, split, mail merge, clean copies, stamps and audits for documents.", icon: "FileType" },
  { id: "finance", name: "Finance", description: "Calculators and accounting data clean-up.", icon: "Calculator" },
  { id: "developer", name: "Developer", description: "Formatters, encoders, hashes and helpers.", icon: "Code2" },
  { id: "web", name: "Web", description: "URLs, headers, DNS and page inspection.", icon: "Globe" },
  { id: "files", name: "Files", description: "Archives, hashes, metadata and encoding.", icon: "FolderArchive" },
  { id: "text", name: "Text", description: "Count, clean, sort, compare and convert text.", icon: "Type" },
  { id: "utilities", name: "Everyday", description: "Time zones, currency conversion, typing test.", icon: "Globe2" },
  { id: "insights", name: "Checks & generators", description: "AI-writing signals, readability, similarity, passwords, test data, invoices, speech.", icon: "Wand2" },
  { id: "ai", name: "AI", description: "Summarize, extract, translate and rewrite with a configured AI provider.", icon: "Sparkles" },
];

export const categoryById = Object.fromEntries(categories.map((c) => [c.id, c])) as Record<
  ToolCategoryId,
  ToolCategory
>;
