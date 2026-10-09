import { icons, Wrench, type LucideProps } from "lucide-react";

/** Resolve a lucide icon by its PascalCase name from the registry. */
export function ToolIcon({ name, ...props }: { name?: string } & LucideProps) {
  const Icon = (name && (icons as Record<string, React.ComponentType<LucideProps>>)[name]) || Wrench;
  return <Icon aria-hidden {...props} />;
}
