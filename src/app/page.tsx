import { Hero } from "@/components/home/Hero";
import { PopularTools, FavoriteTools, RecentTools, CategoryCards, Stats } from "@/components/home/HomeSections";

export default function HomePage() {
  return (
    <>
      <Hero />
      <div className="mx-auto max-w-7xl space-y-16 px-4 sm:px-6 py-14">
        <FavoriteTools />
        <PopularTools />
        <RecentTools />
        <CategoryCards />
        <Stats />
      </div>
    </>
  );
}
