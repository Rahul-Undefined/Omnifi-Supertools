import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Logo } from "@/components/layout/Logo";

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center px-4 py-24 text-center">
      <Logo size="lg" href={null} />
      <p className="mt-10 font-mono text-sm uppercase tracking-[0.2em] text-muted">404</p>
      <h1 className="mt-2 text-3xl font-semibold text-foreground">That page does not exist<span className="brand-dot">.</span></h1>
      <p className="mt-2 text-body">The tool may have moved or the link was mistyped.</p>
      <div className="mt-6 flex gap-2">
        <Link href="/"><Button>Go home</Button></Link>
        <Link href="/tools"><Button variant="secondary">Browse tools</Button></Link>
      </div>
    </div>
  );
}
