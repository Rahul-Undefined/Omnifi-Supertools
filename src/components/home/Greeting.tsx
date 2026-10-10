"use client";
import { useSession } from "@/store/session";

function timeOfDay() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

/** Personal greeting in the hero once someone is signed in. */
export function Greeting() {
  const { user, loaded } = useSession();
  if (!loaded || !user) return <p className="font-mono text-xs uppercase tracking-[0.2em] text-lavender">Omnifi internal platform</p>;
  const first = user.firstName ?? user.name.split(" ")[0];
  return (
    <p className="font-mono text-xs uppercase tracking-[0.2em] text-lavender animate-fade-up">
      {timeOfDay()}, {first} · Omnifi internal platform
    </p>
  );
}
