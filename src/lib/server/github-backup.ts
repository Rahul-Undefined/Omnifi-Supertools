import "server-only";
import { env } from "./env";
import { store, type Snapshot } from "./store";
import { getTool } from "@/tools/registry";

/**
 * GitHub-backed persistence for the file store.
 *
 * A free Render instance loses its disk on every deploy. When GITHUB_DATA_REPO and
 * GITHUB_DATA_TOKEN are set, the server pushes its snapshot (usage, audit, feedback,
 * favourites, accounts, AI allowance counters and cache) to a private data repository
 * every hour and before shutdown, restores it on boot when the local store is empty,
 * and publishes a daily Excel export (people × tools, events, AI usage, feedback).
 * Only JSON/XLSX metadata travels; never file contents. The token is used only for the
 * GitHub contents API of that one repository.
 */

export interface BackupStatus {
  configured: boolean;
  repo?: string;
  branch?: string;
  lastBackupAt?: number;
  lastBackupBytes?: number;
  lastExcelAt?: number;
  lastExcelPath?: string;
  restoredAt?: number;
  restoredFrom?: string;
  lastError?: string;
  lastErrorAt?: number;
}

const status: BackupStatus = { configured: Boolean(env.githubDataRepo && env.githubDataToken), repo: env.githubDataRepo || undefined, branch: env.githubDataBranch };
const SNAPSHOT_PATH = "snapshot.json";

export function backupStatus(): BackupStatus { return { ...status, configured: Boolean(env.githubDataRepo && env.githubDataToken) }; }

function api(path: string) { return `https://api.github.com/repos/${env.githubDataRepo}/contents/${path}`; }
function headers() {
  return { authorization: `Bearer ${env.githubDataToken}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "Omnifi-SuperTools backup" };
}

async function getFile(path: string, fetchFn: typeof fetch = fetch): Promise<{ sha: string; content: Buffer } | null> {
  const res = await fetchFn(`${api(path)}?ref=${encodeURIComponent(env.githubDataBranch)}`, { headers: headers(), cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub GET ${path} failed (${res.status})`);
  const data = (await res.json()) as { sha: string; content?: string; encoding?: string; download_url?: string };
  if (data.content && data.encoding === "base64") return { sha: data.sha, content: Buffer.from(data.content.replace(/\n/g, ""), "base64") };
  // Files over 1 MB come without inline content: fetch the raw download URL.
  if (data.download_url) {
    const raw = await fetchFn(data.download_url, { headers: headers(), cache: "no-store" });
    if (!raw.ok) throw new Error(`GitHub raw ${path} failed (${raw.status})`);
    return { sha: data.sha, content: Buffer.from(await raw.arrayBuffer()) };
  }
  throw new Error(`GitHub GET ${path}: no content`);
}

async function putFile(path: string, content: Buffer, message: string, fetchFn: typeof fetch = fetch): Promise<void> {
  const existing = await getFile(path, fetchFn).catch(() => null);
  const body: Record<string, unknown> = { message, content: content.toString("base64"), branch: env.githubDataBranch };
  if (existing) body.sha = existing.sha;
  const res = await fetchFn(api(path), { method: "PUT", headers: { ...headers(), "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`GitHub PUT ${path} failed (${res.status})${text ? `: ${text.slice(0, 200)}` : ""}`);
  }
}

function fail(e: unknown) {
  status.lastError = e instanceof Error ? e.message : String(e);
  status.lastErrorAt = Date.now();
  console.error("github backup:", status.lastError);
}

/** Push the current store snapshot to the data repository. No-op without configuration or with Postgres. */
export async function backupNow(reason = "scheduled", fetchFn: typeof fetch = fetch): Promise<boolean> {
  if (!backupStatus().configured || store().kind !== "file") return false;
  try {
    const snap = await store().snapshot();
    const json = Buffer.from(JSON.stringify({ savedAt: Date.now(), reason, ...snap }));
    await putFile(SNAPSHOT_PATH, json, `SuperTools snapshot (${reason}) ${new Date().toISOString()}`, fetchFn);
    status.lastBackupAt = Date.now();
    status.lastBackupBytes = json.length;
    status.lastError = undefined;
    return true;
  } catch (e) { fail(e); return false; }
}

/** On boot: if the local store is empty, load the last snapshot from the data repository. */
export async function restoreOnBoot(fetchFn: typeof fetch = fetch): Promise<boolean> {
  if (!backupStatus().configured || store().kind !== "file") return false;
  try {
    const local = await store().snapshot();
    const empty = !local.usage.length && !local.audit.length && !(local.accounts ?? []).length && !Object.keys(local.prefs ?? {}).length;
    if (!empty) return false;
    const file = await getFile(SNAPSHOT_PATH, fetchFn);
    if (!file) return false;
    const remote = JSON.parse(file.content.toString("utf8")) as Partial<Snapshot> & { savedAt?: number };
    const snap: Snapshot = { usage: remote.usage ?? [], audit: remote.audit ?? [], users: remote.users ?? {}, accounts: remote.accounts, prefs: remote.prefs, feedback: remote.feedback, rates: remote.rates, aiCache: remote.aiCache, purgedAt: remote.purgedAt };
    await store().importSnapshot?.(snap);
    status.restoredAt = Date.now();
    status.restoredFrom = remote.savedAt ? new Date(remote.savedAt).toISOString() : "unknown time";
    console.log(`github backup: restored ${snap.usage.length} usage events, ${snap.audit.length} audit rows from ${status.restoredFrom}`);
    return true;
  } catch (e) { fail(e); return false; }
}

/** Build the daily Excel workbook from the store: People × tools, Events, AI usage, Feedback, Users. */
export async function buildExcel(now = Date.now()): Promise<{ name: string; bytes: Buffer }> {
  const XLSX = await import("xlsx");
  const snap = await store().snapshot();
  const wb = XLSX.utils.book_new();
  const dt = (ms: number) => new Date(ms).toLocaleString("en-US", { timeZone: "Asia/Kolkata", hour12: false });
  const isAi = (id: string) => Boolean(getTool(id)?.processor.startsWith("ai."));

  // People × tools
  const people = new Map<string, Map<string, number>>();
  for (const u of snap.usage) { if (!u.user || u.cancelled) continue; const m = people.get(u.user) ?? new Map(); m.set(u.tool, (m.get(u.tool) ?? 0) + 1); people.set(u.user, m); }
  const peopleRows: (string | number)[][] = [["Person", "Tool", "Tool id", "AI tool", "Runs"]];
  for (const [user, m] of [...people.entries()].sort()) for (const [tool, n] of [...m.entries()].sort((a, b) => b[1] - a[1])) peopleRows.push([user, getTool(tool)?.name ?? tool, tool, isAi(tool) ? "yes" : "no", n]);
  const summary: (string | number)[][] = [["Person", "Total runs", "Distinct tools", "AI runs", "AI tools", "Last active (IST)"]];
  for (const [user, m] of [...people.entries()].sort()) {
    const runs = [...m.values()].reduce((a, b) => a + b, 0);
    const aiRuns = [...m.entries()].filter(([t]) => isAi(t)).reduce((a, [, n]) => a + n, 0);
    const last = Math.max(...snap.usage.filter((u) => u.user === user).map((u) => u.at));
    summary.push([user, runs, m.size, aiRuns, [...m.keys()].filter(isAi).length, dt(last)]);
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), "People summary");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(peopleRows), "People x tools");

  const events: (string | number)[][] = [["When (IST)", "Person", "Tool", "Tool id", "AI tool", "OK", "Cancelled", "Duration ms", "Files"]];
  for (const u of [...snap.usage].sort((a, b) => a.at - b.at)) events.push([dt(u.at), u.user ?? "", getTool(u.tool)?.name ?? u.tool, u.tool, isAi(u.tool) ? "yes" : "no", u.ok ? "yes" : "no", u.cancelled ? "yes" : "no", u.ms, u.files]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(events), "Events");

  const ai: (string | number)[][] = [["When (IST)", "Person", "Task", "Detail", "Cached", "Tokens"]];
  for (const a of snap.audit.filter((x) => x.action.startsWith("ai.")).sort((x, y) => x.at - y.at)) {
    const tok = (a.detail ?? "").match(/(\d+)\+(\d+) tok$/);
    ai.push([dt(a.at), a.actor, a.action.slice(3), a.detail ?? "", (a.detail ?? "").startsWith("cache hit") ? "yes" : "no", tok ? Number(tok[1]) + Number(tok[2]) : ""]);
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ai), "AI usage");

  const fb: (string | number)[][] = [["When (IST)", "From", "Kind", "Tool", "Message"]];
  for (const f of snap.feedback ?? []) fb.push([dt(f.at), f.from, f.kind, f.tool ?? "", f.message]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(fb), "Feedback");

  const users: (string | number)[][] = [["Person", "Last seen (IST)"]];
  for (const [u, t] of Object.entries(snap.users).sort()) users.push([u, dt(t)]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(users), "Users");

  const day = new Date(now).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }); // YYYY-MM-DD in IST
  const bytes = Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as ArrayBuffer);
  return { name: `exports/usage-${day}.xlsx`, bytes };
}

/** Push today's Excel export (once per IST day unless forced). */
export async function excelNow(force = false, fetchFn: typeof fetch = fetch): Promise<boolean> {
  if (!backupStatus().configured) return false;
  try {
    const { name, bytes } = await buildExcel();
    if (!force && status.lastExcelPath === name) return false;
    if (!force && (await getFile(name, fetchFn).catch(() => null))) { status.lastExcelPath = name; return false; }
    await putFile(name, bytes, `SuperTools usage export ${name.replace("exports/", "")}`, fetchFn);
    status.lastExcelAt = Date.now();
    status.lastExcelPath = name;
    status.lastError = undefined;
    return true;
  } catch (e) { fail(e); return false; }
}

/** Minutes since midnight in IST. */
function istMinutes(now = Date.now()): number {
  const s = new Date(now).toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata", hour12: false, hour: "2-digit", minute: "2-digit" });
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
}

let started = false;
/** Called from instrumentation on boot: restore, then schedule hourly snapshots, the daily Excel and a shutdown push. */
export async function startGithubBackup(): Promise<void> {
  if (started || !backupStatus().configured || store().kind !== "file") return;
  started = true;
  await restoreOnBoot();
  const every = Math.max(5, env.backupEveryMinutes) * 60_000;
  const t1 = setInterval(() => { void backupNow("hourly"); }, every);
  t1.unref?.();
  const t2 = setInterval(() => { if (istMinutes() >= env.backupExcelMinuteIst) void excelNow(); }, 10 * 60_000);
  t2.unref?.();
  const onStop = () => {
    const done = backupNow("shutdown");
    const timeout = new Promise((r) => setTimeout(r, 8_000));
    void Promise.race([done, timeout]).finally(() => process.exit(0));
  };
  process.once("SIGTERM", onStop);
  process.once("SIGINT", onStop);
  console.log(`github backup: ${env.githubDataRepo}@${env.githubDataBranch}, snapshot every ${every / 60_000} min, Excel daily after ${Math.floor(env.backupExcelMinuteIst / 60)}:${String(env.backupExcelMinuteIst % 60).padStart(2, "0")} IST`);
}
