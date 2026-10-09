"use client";
import { Button } from "@/components/ui/Button";
import { Logo } from "@/components/layout/Logo";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center px-4 py-24 text-center">
      <Logo size="lg" href={null} />
      <h1 className="mt-10 text-3xl font-semibold text-foreground">Something went wrong<span className="brand-dot">.</span></h1>
      <p className="mt-2 text-body">Try again. If it keeps happening, tell the SuperTools admin{error.digest ? ` and quote ${error.digest}` : ""}.</p>
      <div className="mt-6"><Button onClick={reset}>Try again</Button></div>
    </div>
  );
}
