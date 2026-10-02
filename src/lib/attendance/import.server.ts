import { createHash, randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { enqueue, PermanentJobError, type Job } from "../jobs/queue.server";
import { normalizeName } from "./normalize";
import { detectFormat, parseAttendanceFile } from "./parse.server";
import { planImport } from "./plan";
import { computeMonthSafely } from "../scoring/compute.server";
import { AttendanceParseError } from "./types";
import type { MatchContext } from "./match";

// These tables are not in the generated Supabase types yet.
const db = () => supabaseAdmin as any;
const BUCKET = "attendance-uploads";
export const JOB_TYPE = "attendance.import";

const safeName = (name: string) => name.replace(/[^A-Za-z0-9._-]+/g, "_").slice(-100) || "attendance";

/**
 * Stores the raw file, records the upload and queues the import. The file is checked by its
 * bytes (not its name) so a renamed file cannot slip through; it is parsed later by the worker.
 */
export async function enqueueAttendanceImport(input: {
  filename: string;
  bytes: Uint8Array;
  uploadedBy: string;
}): Promise<{ jobId: string; uploadId: string }> {
  const format = detectFormat(input.bytes);
  if (!format) {
    throw new AttendanceParseError("Only the attendance report as a PDF or an Excel (.xlsx) file is accepted.");
  }

  const uploadId = randomUUID();
  const path = `${new Date().getUTCFullYear()}/${uploadId}/${safeName(input.filename)}`;
  const { error: storeError } = await supabaseAdmin.storage.from(BUCKET).upload(path, input.bytes, {
    contentType:
      format === "pdf"
        ? "application/pdf"
        : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    upsert: false,
  });
  if (storeError) throw new Error(`Could not store the file: ${storeError.message}`);

  const { error } = await db()
    .from("attendance_uploads")
    .insert({
      id: uploadId,
      filename: input.filename.slice(0, 200),
      source_format: format,
      file_sha256: createHash("sha256").update(input.bytes).digest("hex"),
      storage_path: path,
      uploaded_by: input.uploadedBy,
    });
  if (error) throw new Error(`Could not record the upload: ${error.message}`);

  const job = await enqueue(JOB_TYPE, { uploadId }, { createdBy: input.uploadedBy });
  return { jobId: job.id, uploadId };
}

export async function loadMatchContext(): Promise<MatchContext> {
  const [emp, ali, exc] = await Promise.all([
    db().from("employees").select("id, name, cosec_id"),
    db().from("employee_aliases").select("alias_key, employee_id"),
    db().from("attendance_exclusions").select("cosec_id, reason"),
  ]);
  for (const r of [emp, ali, exc]) if (r.error) throw new Error(r.error.message);
  return {
    employees: (emp.data ?? []).map((e: any) => ({ id: e.id, name: e.name, cosecId: e.cosec_id ?? null })),
    aliases: new Map((ali.data ?? []).map((a: any) => [normalizeName(a.alias_key), a.employee_id])),
    excluded: new Map((exc.data ?? []).map((x: any) => [x.cosec_id, x.reason || "Excluded"])),
  };
}

async function markUpload(id: string, patch: Record<string, unknown>) {
  const { error } = await db().from("attendance_uploads").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

/** Worker handler: file -> parsed report -> mapped people -> database, saved in one transaction. */
export async function runAttendanceImport(job: Job): Promise<Record<string, unknown>> {
  const uploadId = String(job.payload["uploadId"] ?? "");
  const { data: upload, error } = await db().from("attendance_uploads").select("*").eq("id", uploadId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!upload || !upload.storage_path) throw new PermanentJobError("The uploaded file record no longer exists.");

  await markUpload(uploadId, { status: "processing", error: null });
  try {
    const { data: blob, error: dlError } = await supabaseAdmin.storage.from(BUCKET).download(upload.storage_path);
    if (dlError || !blob) throw new Error(`Could not read the stored file: ${dlError?.message ?? "empty"}`);

    const report = await parseAttendanceFile(new Uint8Array(await blob.arrayBuffer()));
    const plan = planImport(report, await loadMatchContext());

    const { error: rpcError } = await db().rpc("import_attendance_records", {
      p_upload_id: uploadId,
      p_rows: plan.rows,
    });
    if (rpcError) throw new Error(`Saving attendance failed: ${rpcError.message}`);

    // Remember biometric ids so later months map by id even when a name is spelled differently.
    for (const l of plan.learn) {
      await db()
        .from("employees")
        .update({ cosec_id: l.cosecId, updated_at: new Date().toISOString() })
        .eq("id", l.employeeId)
        .is("cosec_id", null);
    }

    await markUpload(uploadId, {
      status: "done",
      period_start: plan.stats.periodStart,
      period_end: plan.stats.periodEnd,
      month_keys: plan.stats.monthKeys,
      stats: plan.stats,
      processed_at: new Date().toISOString(),
    });
    // New attendance changes every score for these months, so recompute them (never fails the import).
    for (const monthKey of plan.stats.monthKeys) await computeMonthSafely(monthKey);
    return plan.stats as unknown as Record<string, unknown>;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // A bad file will not get better on retry; a database hiccup might.
    const permanent = err instanceof AttendanceParseError;
    const lastAttempt = job.attempts >= job.max_attempts;
    await markUpload(uploadId, { status: permanent || lastAttempt ? "failed" : "processing", error: message });
    if (permanent) throw new PermanentJobError(message);
    throw err;
  }
}
