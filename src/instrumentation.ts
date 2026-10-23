/**
 * Runs once when the server starts (Next.js instrumentation hook).
 * Keep-awake: on a free Render instance the service is paused after 15 idle
 * minutes and the next visitor waits ~50 s on Render's wake-up page. Pinging
 * our own public URL every 10 minutes counts as traffic, so the instance never
 * idles. Controlled by KEEP_AWAKE (default on in production when APP_URL is set).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const enabled = (process.env.KEEP_AWAKE ?? "true").toLowerCase() !== "false";
  const base = (process.env.APP_URL ?? process.env.RENDER_EXTERNAL_URL ?? "").replace(/\/$/, "");
  if (process.env.NODE_ENV !== "production" || !enabled || !base) return;
  const everyMs = Math.max(5, Number(process.env.KEEP_AWAKE_MINUTES ?? "10")) * 60_000;
  const ping = async () => {
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 20_000);
      await fetch(`${base}/api/health`, { signal: controller.signal, headers: { "user-agent": "Omnifi-SuperTools keep-awake" }, cache: "no-store" });
      clearTimeout(t);
    } catch { /* network hiccup: the next tick tries again */ }
  };
  const timer = setInterval(ping, everyMs);
  timer.unref?.();
  console.log(`keep-awake: pinging ${base}/api/health every ${everyMs / 60_000} min`);
}
