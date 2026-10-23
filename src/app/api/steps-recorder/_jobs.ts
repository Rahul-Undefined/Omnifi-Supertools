import "server-only";
import { randomUUID } from "node:crypto";
import type { Sop } from "./_generate";

/**
 * In-memory job store for asynchronous SOP generation. The desktop app starts a job, then polls for the
 * result, so a slow model response can never hit an HTTP timeout. Jobs live in this process only (the
 * free Render service runs a single instance) and expire after 30 minutes.
 */
export type SopJob =
  | { id: string; deviceId: string; state: "running"; startedAt: number }
  | { id: string; deviceId: string; state: "done"; startedAt: number; finishedAt: number; sop: Sop; imagesUsed: number; model: string }
  | { id: string; deviceId: string; state: "failed"; startedAt: number; finishedAt: number; error: string; hint?: string; status: number };

const jobs = new Map<string, SopJob>();
const TTL_MS = 30 * 60_000;

function sweep() {
  const cutoff = Date.now() - TTL_MS;
  for (const [id, job] of jobs) if (job.startedAt < cutoff) jobs.delete(id);
}

export function createJob(deviceId: string): SopJob {
  sweep();
  const job: SopJob = { id: randomUUID(), deviceId, state: "running", startedAt: Date.now() };
  jobs.set(job.id, job);
  return job;
}

export function completeJob(id: string, sop: Sop, imagesUsed: number, model: string) {
  const job = jobs.get(id);
  if (!job) return;
  jobs.set(id, { id, deviceId: job.deviceId, state: "done", startedAt: job.startedAt, finishedAt: Date.now(), sop, imagesUsed, model });
}

export function failJob(id: string, error: string, status: number, hint?: string) {
  const job = jobs.get(id);
  if (!job) return;
  jobs.set(id, { id, deviceId: job.deviceId, state: "failed", startedAt: job.startedAt, finishedAt: Date.now(), error, hint, status });
}

export function getJob(id: string, deviceId: string): SopJob | undefined {
  sweep();
  const job = jobs.get(id);
  return job && job.deviceId === deviceId ? job : undefined;
}

/** Number of jobs currently running for a device (used to refuse parallel requests). */
export function runningJobs(deviceId: string): number {
  let n = 0;
  for (const job of jobs.values()) if (job.deviceId === deviceId && job.state === "running") n++;
  return n;
}
