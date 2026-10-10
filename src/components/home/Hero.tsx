import { site } from "@/config/site";
import { SearchBox, SearchExample } from "./SearchBox";
import { Greeting } from "./Greeting";

export function Hero() {
  return (
    <section className="hero-animated relative overflow-hidden bg-navy-800 text-paper">
      {/* Slow-drifting brand-coloured light fields and a floating rounded-square motif.
          Everything collapses to a static backdrop under prefers-reduced-motion. */}
      <span className="hero-blob hero-blob-a" aria-hidden />
      <span className="hero-blob hero-blob-b" aria-hidden />
      <span className="hero-blob hero-blob-c" aria-hidden />
      <span className="hero-grid" aria-hidden />
      <span className="motif hero-motif -right-8 -top-8 h-48 w-48 opacity-70" aria-hidden />
      <span className="motif hero-motif-2 right-16 top-16 h-48 w-48 opacity-30" aria-hidden />
      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 pt-16 pb-20 sm:pt-24 sm:pb-28">
        <Greeting />
        <h1 className="mt-4 max-w-3xl text-4xl font-semibold tracking-tight sm:text-6xl leading-[1.05]">
          {site.headline.replace(/\.$/, "")}<span className="brand-dot">.</span>
        </h1>
        <p className="mt-5 max-w-xl text-lg text-[#B6BAEC]">{site.description}</p>
        <div className="mt-9 max-w-2xl">
          <SearchBox large />
          <ul className="mt-4 flex flex-wrap gap-2" aria-label="Examples">
            {site.searchExamples.map((ex) => (
              <li key={ex}>
                <SearchExample text={ex} />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
