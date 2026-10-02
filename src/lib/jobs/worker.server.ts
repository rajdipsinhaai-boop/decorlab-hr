import { claim, complete, fail, type Job } from "./queue.server";

type Handler = (job: Job) => Promise<Record<string, unknown>>;

/** One entry per job type. Add a new background task by adding a line here. */
const HANDLERS: Record<string, Handler> = {
  "attendance.import": async (job) => (await import("../attendance/import.server")).runAttendanceImport(job),
  "report.generate": async (job) => (await import("../report/generate.server")).runReportGeneration(job),
};

export interface WorkerReport {
  processed: { id: string; type: string; outcome: "done" | "retry" | "failed"; error?: string }[];
}

const WORKER_ID = () => `app-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * Drains the queue. Called right after an upload (so results appear immediately) and by the
 * scheduled endpoint (which retries anything that failed or was left behind).
 * Stops when the queue is empty, `maxJobs` is reached or the time budget is spent.
 */
export async function runWorker(
  opts: { maxJobs?: number; budgetMs?: number; jobId?: string; types?: string[] } = {},
): Promise<WorkerReport> {
  const { maxJobs = 5, budgetMs = 40_000, jobId, types = Object.keys(HANDLERS) } = opts;
  const started = Date.now();
  const workerId = WORKER_ID();
  const report: WorkerReport = { processed: [] };

  while (report.processed.length < maxJobs && Date.now() - started < budgetMs) {
    const job = await claim(workerId, { types, ...(jobId ? { jobId } : {}) });
    if (!job) break;
    const handler = HANDLERS[job.type];
    if (!handler) {
      await fail(job, new Error(`No handler is registered for job type "${job.type}".`));
      report.processed.push({ id: job.id, type: job.type, outcome: "failed", error: "no handler" });
      continue;
    }
    try {
      await complete(job.id, await handler(job));
      report.processed.push({ id: job.id, type: job.type, outcome: "done" });
    } catch (error) {
      console.error(`Job ${job.id} (${job.type}) failed:`, error);
      const outcome = await fail(job, error);
      report.processed.push({
        id: job.id,
        type: job.type,
        outcome,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    if (jobId) break; // a targeted run handles exactly that job
  }
  return report;
}
