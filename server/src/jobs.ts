import { randomUUID } from "node:crypto";
import { rootCause } from "./chain.js";


export type Job = {
  readonly id: string;
  readonly action: string;
  status: "running" | "done" | "failed";
  readonly startedAt: number;
  finishedAt?: number;
  result?: unknown;
  error?: string;
};

const jobs = new Map<string, Job>();

export const start = (action: string, work: () => Promise<unknown>): Job => {
  const job: Job = {
    id: randomUUID().slice(0, 8),
    action,
    status: "running",
    startedAt: Date.now(),
  };
  jobs.set(job.id, job);

  work().then(
    (result) => {
      job.status = "done";
      job.result = result;
      job.finishedAt = Date.now();
    },
    (error: unknown) => {
      job.status = "failed";
      job.error = rootCause(error);
      job.finishedAt = Date.now();
    },
  );

  return job;
};

export const getJob = (id: string): Job | undefined => jobs.get(id);

export const pruneJobs = (maxAgeMs = 3_600_000): void => {
  const cutoff = Date.now() - maxAgeMs;
  for (const [id, job] of jobs) {
    if (job.startedAt < cutoff) jobs.delete(id);
  }
};
