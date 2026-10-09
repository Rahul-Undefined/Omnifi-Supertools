export type ToolCategoryId =
  | "documents"
  | "images"
  | "media"
  | "office"
  | "finance"
  | "developer"
  | "web"
  | "files"
  | "text"
  | "utilities"
  | "ai";

export type ToolKind =
  | "file" // upload files -> options -> run -> download
  | "text" // text in -> text out
  | "calculator" // form in -> computed result
  | "generator"; // options -> generated output (e.g. QR, UUID)

export type ToolStatus = "ready" | "coming-soon";

/** Where the work happens. Drives the privacy notice on the tool page. */
export type ToolRuntime = "browser" | "server";

export type OptionField =
  | {
      type: "select";
      key: string;
      label: string;
      options: { value: string; label: string }[];
      default: string;
      help?: string;
    }
  | { type: "number"; key: string; label: string; default: number; min?: number; max?: number; step?: number; help?: string }
  | { type: "range"; key: string; label: string; default: number; min: number; max: number; step?: number; help?: string }
  | { type: "text"; key: string; label: string; default: string; placeholder?: string; help?: string }
  | { type: "textarea"; key: string; label: string; default: string; placeholder?: string; help?: string }
  | { type: "checkbox"; key: string; label: string; default: boolean; help?: string }
  | { type: "color"; key: string; label: string; default: string; help?: string };

export type OptionValues = Record<string, string | number | boolean>;

export interface ToolDefinition {
  id: string;
  name: string;
  category: ToolCategoryId;
  description: string;
  keywords: string[];
  /** Accepted input MIME types / extensions. Empty for text/calculator tools. */
  input: string[];
  /** Output formats produced. */
  output: string[];
  /** Processor id resolved by src/processors/index.ts (client). */
  processor: string;
  kind: ToolKind;
  status: ToolStatus;
  runtime: ToolRuntime;
  /** Accept multiple files and process in a batch. */
  multiple?: boolean;
  /** Exact number of files required (e.g. compare tools need 2). */
  fileCount?: number;
  /** Treat all uploaded files as one job (merge) instead of one job per file. */
  combine?: boolean;
  options?: OptionField[];
  /** Ids of related tools to surface on the tool page. */
  related?: string[];
  /** Whether this step can be chained in the workflow builder. */
  chainable?: boolean;
  /** Icon name from lucide-react. */
  icon?: string;
  /** Label for the text input (text tools). */
  inputLabel?: string;
  /** Placeholder for the text input (text tools). */
  inputPlaceholder?: string;
}

export interface ToolCategory {
  id: ToolCategoryId;
  name: string;
  description: string;
  icon: string;
}
