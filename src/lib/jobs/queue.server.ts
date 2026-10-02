import { supabaseAdmin } from "@/integrations/supabase/client.server";

// The jobs table is not in the generated Supabase types yet.
const db = () => supabaseAdmin as any;

export interface Job {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  status: "queued" | "running" | "done" | "failed";
  attempts: number;
  max_attempts: number;
  run_after: string;
  result: Record<string, unknown> | null;
  error: string | null;
  created_by: string | null;
  created_at: string;
  finished_at: string | null;
}

/** Throw this for failures a retry cannot fix (bad file, missing record): the job fails at once. */
export class PermanentJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentJobError";
  }
}

export async function enqueue(
  type: string,
  payload: Record<string, unknown>,
  opts: { createdBy?: string; maxAttempts?: number } = {},
): Promise<Job> {
  const { data, error } = await db()
    .from("jobs")
    .insert({
      type,
      payload,
      created_by: opts.createdBy ?? null,
      ...(opts.maxAttempts ? { max_attempts: opts.maxAttempts } : {}),
    })
    .select("*")
    .single();
  if (error) throw new Error(`Could not queue the job: ${error.message}`);
  return data as Job;
}

/** Atomically takes the next runnable job (see claim_job in the migration). */
export async function claim(
  workerId: string,
  opts: { types?: string[]; jobId?: string } = {},
): Promise<Job | null> {
  const { data, error } = await db().rpc("claim_job", {
    p_worker: workerId,
    p_types: opts.types ?? null,
    p_job_id: opts.jobId ?? null,
  });
  if (error) throw new Error(`Could not claim a job: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  return (row as Job | undefined) ?? null;
}

export async function complete(id: string, result: Record<string, unknown>): Promise<void> {
  const { error } = await db()
    .from("jobs")
    .update({ status: "done", result, error: null, finished_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/** Retries with exponential backoff (1 min, 2 min, ...) until attempts run out, then fails for good. */
export async function fail(job: Job, err: unknown): Promise<"retry" | "failed"> {
  const message = (err instanceof Error ? err.message : String(err)).slice(0, 1000);
  const permanent = err instanceof PermanentJobError || job.attempts >= job.max_attempts;
  const now = new Date();
  const patch = permanent
    ? { status: "failed", error: message, finished_at: now.toISOString(), updated_at: now.toISOString() }
    : {
        status: "queued",
        error: message,
        run_after: new Date(now.getTime() + 60_000 * 2 ** (job.attempts - 1)).toISOString(),
        locked_at: null,
        locked_by: null,
        updated_at: now.toISOString(),
      };
  const { error } = await db().from("jobs").update(patch).eq("id", job.id);
  if (error) throw new Error(error.message);
  return permanent ? "failed" : "retry";
}

export async function getJob(id: string): Promise<Job | null> {
  const { data, error } = await db().from("jobs").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as Job | null) ?? null;
}
