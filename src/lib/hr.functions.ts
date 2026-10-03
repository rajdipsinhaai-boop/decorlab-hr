import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type {
  AccessUser,
  AttendanceUploadResult,
  AttendanceUploadRow,
  ControlRow,
  DashboardView,
  ViewerRole,
} from "./hr-types";

const CONTROL_RANGE = "Control!A:H";
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_BASE64 = Math.ceil((MAX_BYTES * 4) / 3) + 1024;

function utcStamp() {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

async function assertAllowed(context: { supabase: any; claims: any }) {
  const { resolveAccess } = await import("./access.server");
  return resolveAccess(context);
}

async function assertAdmin(context: { supabase: any; claims: any }): Promise<string> {
  const { email, role } = await assertAllowed(context);
  if (role !== "admin") throw new Error("Only administrators can manage user access.");
  return email;
}

/** Admin-only surfaces (scores, reports, AI assistant, and access management). */
async function assertLeadership(context: { supabase: any; claims: any }): Promise<string> {
  const { email, role } = await assertAllowed(context);
  if (role !== "admin") {
    throw new Error("Your account does not have access to performance scores.");
  }
  return email;
}

/** Upload surfaces: managers and admins only (employees only view their own result). */
async function assertUploader(context: { supabase: any; claims: any }) {
  const access = await assertAllowed(context);
  if (access.role === "employee") throw new Error("Only managers and administrators can upload files.");
  return access;
}

// Month labels end up in Drive folder names/queries and Sheets cells (USER_ENTERED), so accept only "Month YYYY".
const MONTH_RE =
  /^(January|February|March|April|May|June|July|August|September|October|November|December) \d{4}$/;
function validMonth(value: unknown): string {
  if (typeof value !== "string" || !MONTH_RE.test(value)) throw new Error("A valid month is required.");
  return value;
}

export const getDashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input?: { month?: string }) => ({ month: input?.month?.trim() || undefined }))
  .handler(async ({ data: input, context }): Promise<DashboardView> => {
    const { role, employeeId, employeeName } = await assertAllowed(context as never);
    const { loadDashboard } = await import("./hr.server");
    const { findOwn } = await import("./access.server");
    const data = await loadDashboard(input.month);
    if (role === "manager") {
      const own =
        findOwn(data.employees, { employeeId, employeeName });
      return {
        viewerRole: "manager",
        month: data.month,
        months: data.months,
        own,
        roster: data.employees.map((e) => ({
          id: e.id,
          name: e.name,
          role: e.role,
          roleGroup: e.roleGroup,
        })),
      };
    }
    if (role === "employee") {
      const employee =
        findOwn(data.employees, { employeeId, employeeName });
      return { viewerRole: "employee", month: data.month, employee };
    }
    return { viewerRole: "admin", data };
  });

export const listAccessUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AccessUser[]> => {
    await assertAdmin(context as never);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let data: any[] | null = null;
    let error: any = null;
    ({ data, error } = await supabaseAdmin
      .from("allowed_emails")
      .select("*")
      .order("created_at", { ascending: true }));
    if (error) {
      ({ data, error } = await supabaseAdmin
        .from("allowed_emails")
        .select("id, email, role, created_at")
        .order("created_at", { ascending: true }));
    }
    if (error) throw new Error(error.message);
    return (data ?? []).map((row: any) => ({
      id: row.id,
      email: row.email,
      role: row.role as ViewerRole,
      employeeId: row.employee_id ?? null,
      employeeName: row.employee_name ?? null,
      position: row.position ?? null,
      createdAt: row.created_at,
    }));
  });

export const saveAccessUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      email: string;
      role: ViewerRole;
      employeeId?: string | undefined;
      employeeName?: string | undefined;
      position?: string | undefined;
    }) => {
      const email = (input?.email ?? "").trim().toLowerCase();
      if (!email || !email.includes("@") || email.length > 200)
        throw new Error("Enter a valid email.");
      if (!["admin", "manager", "employee"].includes(input.role))
        throw new Error("Choose a valid role.");
      return {
        email,
        role: input.role,
        employeeId: input.employeeId?.trim() || null,
        employeeName: input.employeeName?.trim() || null,
        position: input.position?.trim().slice(0, 80) || null,
      };
    },
  )
  .handler(async ({ data, context }): Promise<AccessUser> => {
    await assertAdmin(context as never);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let row: any;
    let error: any;
    ({ data: row, error } = await supabaseAdmin
      .from("allowed_emails")
      .upsert(
        {
          email: data.email,
          role: data.role,
          employee_id: data.employeeId,
          employee_name: data.employeeName,
          position: data.position,
        },
        { onConflict: "email" },
      )
      .select("*")
      .single());
    if (error) {
      ({ data: row, error } = await supabaseAdmin
        .from("allowed_emails")
        .upsert({ email: data.email, role: data.role }, { onConflict: "email" })
        .select("id, email, role, created_at")
        .single());
    }
    if (error) throw new Error(error.message);
    return {
      id: row.id,
      email: row.email,
      role: row.role as ViewerRole,
      employeeId: row.employee_id ?? null,
      employeeName: row.employee_name ?? null,
      position: row.position ?? null,
      createdAt: row.created_at,
    };
  });

export const forceConfirmUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { email: string }) => {
    const email = (input?.email ?? "").trim().toLowerCase();
    if (!email || !email.includes("@") || email.length > 200)
      throw new Error("Enter a valid email.");
    return { email };
  })
  .handler(async ({ data, context }): Promise<{ email: string; confirmed: boolean }> => {
    await assertAdmin(context as never);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let user: { id: string } | undefined;
    for (let page = 1; !user; page++) {
      const { data: res, error: listError } = await supabaseAdmin.auth.admin.listUsers({
        page,
        perPage: 1000,
      });
      if (listError) throw new Error(listError.message);
      user = res.users.find((c) => c.email?.toLowerCase() === data.email);
      if (res.users.length < 1000) break;
    }
    if (!user) throw new Error("No account exists for this email yet.");
    const { error } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
      email_confirm: true,
    });
    if (error) throw new Error(error.message);
    return { email: data.email, confirmed: true };
  });

/** Status of a request: a database job (report cards) or, for WhatsApp exports, a Control-sheet row. */
export const getReportStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { requestId: string }) => {
    if (!input?.requestId) throw new Error("A request id is required.");
    return { requestId: input.requestId };
  })
  .handler(async ({ data, context }): Promise<ControlRow | null> => {
    await assertAllowed(context as never);
    const { getJob } = await import("./jobs/queue.server");
    const job = /^[0-9a-f-]{36}$/i.test(data.requestId) ? await getJob(data.requestId).catch(() => null) : null;
    if (job && job.type === "report.generate") {
      return {
        requestId: job.id,
        requestedAt: job.created_at,
        requestedBy: job.created_by ?? "",
        month: String(job.payload["monthKey"] ?? ""),
        status: job.status === "done" ? "DONE" : job.status === "failed" ? "FAILED" : job.status.toUpperCase(),
        driveLink: "",
        completedAt: job.finished_at ?? "",
        type: "Create Report",
      };
    }
    const { loadControlRows } = await import("./hr.server");
    const rows = await loadControlRows();
    return rows.find((r) => r.requestId === data.requestId) ?? null;
  });

/** Recompute a month's scores from the latest attendance, audit and director ratings. */
export const recalculateMonth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { month: string }) => ({ month: validMonth(input?.month) }))
  .handler(async ({ data, context }) => {
    await assertAdmin(context as never);
    const { monthKeyOf } = await import("./attendance/normalize");
    const { computeMonth } = await import("./scoring/compute.server");
    return computeMonth(monthKeyOf(data.month)!);
  });

/**
 * Lock a month: scores stop recomputing and the report cards are generated and stored.
 * Refuses while anyone is still Pending unless `force` is set.
 */
export const finalizeMonth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { month: string; force?: boolean }) => ({
    month: validMonth(input?.month),
    force: Boolean(input?.force),
  }))
  .handler(async ({ data, context }): Promise<{ pending: string[]; jobId: string | null }> => {
    const email = await assertAdmin(context as never);
    const { monthKeyOf } = await import("./attendance/normalize");
    const { computeMonth, isFinalized } = await import("./scoring/compute.server");
    const { loadDashboard } = await import("./hr.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const key = monthKeyOf(data.month)!;
    if (await isFinalized(key)) throw new Error(`${data.month} is already finalized.`);

    await computeMonth(key);
    const dashboard = await loadDashboard(data.month);
    if (dashboard.month !== data.month) throw new Error(`There is no data for ${data.month}.`);
    const pending = dashboard.employees.filter((e) => e.score === null).map((e) => e.name);
    if (pending.length && !data.force) return { pending, jobId: null };

    const { error } = await (supabaseAdmin as any).from("month_locks").insert({ month_key: key, finalized_by: email });
    if (error) throw new Error(error.message);

    const { enqueue } = await import("./jobs/queue.server");
    const { runWorker } = await import("./jobs/worker.server");
    const job = await enqueue("report.generate", { monthKey: key }, { createdBy: email });
    await runWorker({ jobId: job.id, budgetMs: 40_000 });
    // Then send each person their card on WhatsApp. A problem here never undoes the finalize:
    // the job retries on its own and skips anyone already sent.
    try {
      const wa = await enqueue("report.whatsapp", { monthKey: key }, { createdBy: email });
      await runWorker({ jobId: wa.id, budgetMs: 40_000 });
    } catch (error) {
      console.error("WhatsApp send could not start:", error);
    }
    return { pending: [], jobId: job.id };
  });

export const reopenMonth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { month: string }) => ({ month: validMonth(input?.month) }))
  .handler(async ({ data, context }) => {
    await assertAdmin(context as never);
    const { monthKeyOf } = await import("./attendance/normalize");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await (supabaseAdmin as any).from("month_locks").delete().eq("month_key", monthKeyOf(data.month));
    if (error) throw new Error(error.message);
    return { reopened: true };
  });

interface UploadInput {
  month: string;
  filename: string;
  base64: string;
  group?: string;
}

function validateUpload(input: UploadInput, ext: ".pdf" | ".txt"): UploadInput {
  validMonth(input?.month);
  if (!input?.filename || !input.filename.toLowerCase().endsWith(ext)) {
    throw new Error(`Please select a ${ext} file.`);
  }
  if (!input?.base64 || typeof input.base64 !== "string") throw new Error("No file was received.");
  if (input.base64.length > MAX_BASE64) throw new Error("File is larger than 20MB.");
  return input;
}

/** Longest the upload request waits for the worker before handing back a "still running" status. */
const INLINE_WORKER_MS = 45_000;

/**
 * Attendance upload: stores the file, queues an import job and runs the worker straight away.
 * The month is read from the report itself, so there is nothing to choose.
 */
export const uploadAttendance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { filename: string; base64: string }) => {
    if (!input?.filename || typeof input.filename !== "string") throw new Error("No file was received.");
    if (!input.base64 || typeof input.base64 !== "string") throw new Error("No file was received.");
    if (input.base64.length > MAX_BASE64) throw new Error("File is larger than 20MB.");
    return { filename: input.filename, base64: input.base64 };
  })
  .handler(async ({ data, context }): Promise<AttendanceUploadResult> => {
    const { email } = await assertUploader(context as never);
    const { enqueueAttendanceImport } = await import("./attendance/import.server");
    const { runWorker } = await import("./jobs/worker.server");
    const { getJob } = await import("./jobs/queue.server");

    // Files that are not the attendance report are rejected here, before anything is stored.
    const { jobId, uploadId } = await enqueueAttendanceImport({
      filename: data.filename,
      bytes: new Uint8Array(Buffer.from(data.base64, "base64")),
      uploadedBy: email,
    });
    // Run the worker now so the result is usually ready when this request returns; the scheduled
    // endpoint retries anything that did not finish.
    await runWorker({ jobId, budgetMs: INLINE_WORKER_MS });

    const job = await getJob(jobId);
    return {
      jobId,
      uploadId,
      status: job?.status ?? "queued",
      ...(job?.status === "done" && job.result ? { stats: job.result as never } : {}),
      ...(job?.error ? { error: job.error } : {}),
    };
  });

export const getAttendanceJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { jobId: string }) => {
    if (!input?.jobId) throw new Error("A job id is required.");
    return { jobId: input.jobId };
  })
  .handler(async ({ data, context }): Promise<AttendanceUploadResult | null> => {
    await assertUploader(context as never);
    const { getJob } = await import("./jobs/queue.server");
    const job = await getJob(data.jobId);
    if (!job || job.type !== "attendance.import") return null;
    return {
      jobId: job.id,
      uploadId: String(job.payload["uploadId"] ?? ""),
      status: job.status,
      ...(job.status === "done" && job.result ? { stats: job.result as never } : {}),
      ...(job.error ? { error: job.error } : {}),
    };
  });

/** Recent attendance uploads with what was parsed and who could not be mapped. */
export const listAttendanceUploads = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AttendanceUploadRow[]> => {
    await assertUploader(context as never);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await (supabaseAdmin as any)
      .from("attendance_uploads")
      .select(
        "id, filename, source_format, status, month_keys, period_start, period_end, uploaded_by, created_at, error, stats",
      )
      .order("created_at", { ascending: false })
      .limit(10);
    if (error) throw new Error(error.message);
    return (data ?? []).map((r: any) => ({
      id: r.id,
      filename: r.filename,
      format: r.source_format,
      status: r.status,
      monthKeys: r.month_keys ?? [],
      periodStart: r.period_start,
      periodEnd: r.period_end,
      uploadedBy: r.uploaded_by,
      createdAt: r.created_at,
      error: r.error,
      stats: r.stats && Object.keys(r.stats).length ? r.stats : null,
    }));
  });

/**
 * Admin decision for a biometric identity that is not on the roster:
 *  - map: link it to an employee (their attendance is attached and future uploads match by id)
 *  - exclude: ignore this person entirely (their stored rows are removed)
 */
export const resolveAttendanceIdentity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { cosecId: string; name: string; action: "map" | "exclude"; employeeId?: string; reason?: string }) => {
      const cosecId = (input?.cosecId ?? "").trim().toUpperCase();
      if (!/^[A-Z]{0,3}\d+$/.test(cosecId)) throw new Error("A valid biometric id is required.");
      if (input.action !== "map" && input.action !== "exclude") throw new Error("Choose map or exclude.");
      if (input.action === "map" && !input.employeeId) throw new Error("Choose which employee this is.");
      return {
        cosecId,
        name: (input.name ?? "").trim().slice(0, 120),
        action: input.action,
        employeeId: input.employeeId?.trim(),
        reason: (input.reason ?? "").trim().slice(0, 200),
      };
    },
  )
  .handler(async ({ data, context }): Promise<{ relinked: number }> => {
    await assertAdmin(context as never);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { normalizeName } = await import("./attendance/normalize");
    const db = supabaseAdmin as any;

    if (data.action === "exclude") {
      const { error } = await db.from("attendance_exclusions").upsert({
        cosec_id: data.cosecId,
        name: data.name,
        reason: data.reason || "Excluded by an administrator",
      });
      if (error) throw new Error(error.message);
      const { error: delError } = await db.from("attendance_records").delete().eq("cosec_id", data.cosecId);
      if (delError) throw new Error(delError.message);
      return { relinked: 0 };
    }

    const { data: emp, error: empError } = await db
      .from("employees")
      .select("id, cosec_id")
      .eq("id", data.employeeId)
      .maybeSingle();
    if (empError) throw new Error(empError.message);
    if (!emp) throw new Error("That employee does not exist.");
    if (emp.cosec_id && emp.cosec_id !== data.cosecId) {
      throw new Error(`That employee is already linked to biometric id ${emp.cosec_id}.`);
    }
    const { error: linkError } = await db.from("employees").update({ cosec_id: data.cosecId }).eq("id", emp.id);
    if (linkError) throw new Error(linkError.message);
    // Remember this spelling too, then attach every record already stored for this id.
    if (data.name) {
      await db
        .from("employee_aliases")
        .upsert({ alias_key: normalizeName(data.name), employee_id: emp.id, source: "admin" });
    }
    const { data: updated, error: upError } = await db
      .from("attendance_records")
      .update({ employee_id: emp.id })
      .eq("cosec_id", data.cosecId)
      .is("employee_id", null)
      .select("id");
    if (upError) throw new Error(upError.message);
    return { relinked: updated?.length ?? 0 };
  });

export const uploadWhatsAppExport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: UploadInput) => {
    const valid = validateUpload(input, ".txt");
    const group = (valid.group ?? "").toString();
    if (group !== "Decorlab Designers Group" && group !== "Decorlab Supervisors Group") {
      throw new Error("Please choose which WhatsApp group this export is from.");
    }
    return { ...valid, group };
  })
  .handler(async ({ data, context }): Promise<{ requestId: string; driveLink: string }> => {
    const { email } = await assertUploader(context as never);
    const { findOrCreateFolder, uploadFile } = await import("./drive.server");
    const { appendRow } = await import("./sheets.server");

    const prefix = data.group!.includes("Designers") ? "Designers Group" : "Supervisors Group";
    const folderId = await findOrCreateFolder(`${data.month} - WhatsApp Exports`);
    const driveLink = await uploadFile({
      folderId,
      filename: `${prefix} - ${data.month}.txt`,
      mimeType: "text/plain",
      base64: data.base64,
    });

    const requestId = crypto.randomUUID();
    await appendRow(CONTROL_RANGE, [
      requestId,
      utcStamp(),
      email,
      data.month,
      "PENDING",
      driveLink,
      "",
      "WhatsApp Export",
    ]);
    return { requestId, driveLink };
  });

/** Last upload month per WhatsApp group, read from the Control tab. */
export const getWhatsAppUploadHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<Record<string, string>> => {
    await assertUploader(context as never);
    const { loadControlRows } = await import("./hr.server");
    const rows = (await loadControlRows()).filter((r) => r.type === "WhatsApp Export");
    const out: Record<string, string> = {};
    for (const row of rows) {
      const group = row.driveLink.includes("Supervisors")
        ? "Decorlab Supervisors Group"
        : "Decorlab Designers Group";
      out[group] = row.month;
    }
    return out;
  });

export const askAssistant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { question: string; history?: { role: string; content: string }[] }) => {
    if (!input?.question?.trim()) throw new Error("Please type a question.");
    if (input.question.length > 1200) throw new Error("That question is too long.");
    return {
      question: input.question.trim(),
      history: (input.history ?? []).slice(-8),
    };
  })
  .handler(async ({ data, context }): Promise<{ answer: string }> => {
    await assertLeadership(context as never);
    const { answerQuestion } = await import("./assistant.server");
    return { answer: await answerQuestion(data.question, data.history) };
  });

export type DirectorRatingDetail = {
  id: string;
  review_month: string;
  employee_id: string;
  employee_name: string;
  role: string;
  kra_parameter: string;
  weight: number | null;
  /** null = not rated yet (different from a real 0). */
  rating_1_to_5: number | null;
  weighted_score: number | null;
  source_tab: string;
  notes: string | null;
  updated_at: string;
};

export const getDirectorRatingDetails = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { month: string }) => {
    const month = (input?.month ?? "").trim();
    if (!month || month.length > 60) throw new Error("A valid review month is required.");
    return { month };
  })
  .handler(async ({ data, context }): Promise<DirectorRatingDetail[]> => {
    await assertAdmin(context as never);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("monthly_director_rating_details")
      .select(
        "id, review_month, employee_id, employee_name, role, kra_parameter, weight, rating_1_to_5, weighted_score, source_tab, notes, updated_at",
      )
      .eq("review_month", data.month)
      .order("employee_name", { ascending: true })
      .order("kra_parameter", { ascending: true });
    if (error) throw new Error(error.message);
    return (rows ?? []) as DirectorRatingDetail[];
  });

export const saveDirectorRatingDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      reviewMonth: string;
      employeeId: string;
      employeeName: string;
      role?: string;
      kraParameter: string;
      weight?: number | null;
      rating1To5: number | null;
      weightedScore?: number | null;
      sourceTab?: string;
      notes?: string | null;
    }) => {
      const reviewMonth = (input?.reviewMonth ?? "").trim();
      const employeeId = (input?.employeeId ?? "").trim();
      const employeeName = (input?.employeeName ?? "").trim();
      const kraParameter = (input?.kraParameter ?? "").trim();
      if (!reviewMonth || !employeeId || !employeeName || !kraParameter) {
        throw new Error("Review month, employee, employee name, and KRA parameter are required.");
      }
      if (
        input.rating1To5 !== null &&
        (!Number.isFinite(input.rating1To5) || input.rating1To5 < 0 || input.rating1To5 > 5)
      ) {
        throw new Error("Rating must be a number from 0 to 5, or left blank for not rated.");
      }
      if (input.weight != null && !Number.isFinite(input.weight))
        throw new Error("Weight must be numeric.");
      if (input.weightedScore != null && !Number.isFinite(input.weightedScore)) {
        throw new Error("Weighted score must be numeric.");
      }
      return {
        reviewMonth,
        employeeId,
        employeeName,
        role: (input.role ?? "").trim(),
        kraParameter,
        weight: input.weight ?? null,
        rating1To5: input.rating1To5 === null ? null : Math.round(input.rating1To5 * 100) / 100,
        weightedScore: input.weightedScore ?? null,
        sourceTab: (input.sourceTab ?? "").trim(),
        notes: input.notes?.trim() || null,
      };
    },
  )
  .handler(async ({ data, context }): Promise<DirectorRatingDetail> => {
    await assertAdmin(context as never);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // rating_1_to_5 is nullable now; the generated types predate that migration
    const { data: row, error } = await (supabaseAdmin as any)
      .from("monthly_director_rating_details")
      .upsert(
        {
          review_month: data.reviewMonth,
          employee_id: data.employeeId,
          employee_name: data.employeeName,
          role: data.role,
          kra_parameter: data.kraParameter,
          weight: data.weight,
          rating_1_to_5: data.rating1To5,
          weighted_score: data.weightedScore,
          source_tab: data.sourceTab,
          notes: data.notes,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "review_month,employee_id,kra_parameter" },
      )
      .select(
        "id, review_month, employee_id, employee_name, role, kra_parameter, weight, rating_1_to_5, weighted_score, source_tab, notes, updated_at",
      )
      .single();
    if (error) throw new Error(error.message);
    const { monthKeyOf } = await import("./attendance/normalize");
    const key = monthKeyOf(data.reviewMonth);
    if (key) {
      const { computeMonthSafely } = await import("./scoring/compute.server");
      await computeMonthSafely(key);
    }
    return row as DirectorRatingDetail;
  });

/**
 * Makes sure every active employee has one rating row per KRA parameter for the month, blank (not
 * rated yet), so the ratings screen is never empty. Existing ratings are never touched.
 */
export const openRatingMonth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { month: string }) => ({ month: validMonth(input?.month) }))
  .handler(async ({ data, context }): Promise<{ created: number }> => {
    await assertAdmin(context as never);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const [emp, params, have] = await Promise.all([
      db.from("employees").select("id, name, role, role_group, status"),
      db.from("kra_parameters").select("*"),
      db.from("monthly_director_rating_details").select("employee_id, kra_parameter").eq("review_month", data.month),
    ]);
    for (const r of [emp, params, have]) if (r.error) throw new Error(r.error.message);
    const existing = new Set((have.data ?? []).map((r: any) => `${r.employee_id}|${r.kra_parameter}`));
    const rows: Record<string, unknown>[] = [];
    for (const e of emp.data ?? []) {
      if (String(e.status).toLowerCase() === "inactive") continue;
      for (const p of params.data ?? []) {
        if (p.role_group !== e.role_group || existing.has(`${e.id}|${p.name}`)) continue;
        rows.push({
          review_month: data.month,
          employee_id: e.id,
          employee_name: e.name,
          role: e.role,
          kra_parameter: p.name,
          weight: Number(p.weight),
          rating_1_to_5: null,
          weighted_score: null,
          source_tab: "Director Ratings",
        });
      }
    }
    if (rows.length) {
      const { error } = await db
        .from("monthly_director_rating_details")
        .upsert(rows, { onConflict: "review_month,employee_id,kra_parameter", ignoreDuplicates: true });
      if (error) throw new Error(error.message);
    }
    return { created: rows.length };
  });

/** Saves several ratings at once (a blank rating means "not rated"), then recomputes the month once. */
export const saveDirectorRatings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      month: string;
      ratings: { id: string; rating: number | null; notes?: string | null }[];
    }) => {
      const month = validMonth(input?.month);
      const ratings = (input?.ratings ?? []).map((r) => {
        if (!r?.id) throw new Error("A rating row id is required.");
        if (r.rating !== null && (!Number.isFinite(r.rating) || r.rating < 0 || r.rating > 5)) {
          throw new Error("Each rating must be 0 to 5, or blank for not rated.");
        }
        return { id: r.id, rating: r.rating === null ? null : Math.round(r.rating * 100) / 100, notes: r.notes?.trim() || null };
      });
      if (!ratings.length || ratings.length > 200) throw new Error("Nothing to save.");
      return { month, ratings };
    },
  )
  .handler(async ({ data, context }): Promise<{ saved: number; scores: string }> => {
    await assertAdmin(context as never);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { monthKeyOf } = await import("./attendance/normalize");
    const db = supabaseAdmin as any;
    for (const r of data.ratings) {
      const { error } = await db
        .from("monthly_director_rating_details")
        .update({ rating_1_to_5: r.rating, notes: r.notes, updated_at: new Date().toISOString() })
        .eq("id", r.id)
        .eq("review_month", data.month);
      if (error) throw new Error(error.message);
    }
    const { computeMonthSafely } = await import("./scoring/compute.server");
    return {
      saved: data.ratings.length,
      scores: JSON.stringify(await computeMonthSafely(monthKeyOf(data.month)!)),
    };
  });

/** Status of any job in the database queue (report generation, attendance import). */
export const getJobStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { jobId: string }) => {
    if (!input?.jobId) throw new Error("A job id is required.");
    return { jobId: input.jobId };
  })
  .handler(async ({ data, context }) => {
    await assertUploader(context as never);
    const { getJob } = await import("./jobs/queue.server");
    const job = await getJob(data.jobId);
    return job ? { status: job.status, error: job.error, result: JSON.stringify(job.result ?? null) } : null;
  });

type JsonValue = string | number | boolean | null | { [k: string]: JsonValue } | JsonValue[];
export type IngestRow = { id: string; source: string; payload: JsonValue; received_at: string };

/** Payloads the Claude scheduled task posted to /api/public/rdash-ingest this month (UTC), newest first. */
export const getIngestsThisMonth = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<IngestRow[]> => {
    await assertAdmin(context as never);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
    // table isn't in generated types until types.ts is regenerated
    const { data, error } = await (supabaseAdmin as any)
      .from("rdash_ingests")
      .select("id, source, payload, received_at")
      .gte("received_at", monthStart)
      .order("received_at", { ascending: false })
      .limit(20);
    if (error) throw new Error(error.message);
    return (data ?? []) as IngestRow[];
  });

export interface WhatsAppRow {
  employeeId: string;
  name: string;
  role: string;
  phone: string | null;
  status: "sent" | "failed" | "pending";
  error: string | null;
  sentAt: string | null;
}
export interface WhatsAppStatus {
  month: string;
  finalized: boolean;
  configured: boolean;
  sendingEnabled: boolean;
  testMode: boolean;
  template: string;
  rows: WhatsAppRow[];
}

/** Who has been sent their report card on WhatsApp for a month, and who has not (admins only). */
export const getWhatsAppStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { month: string }) => ({ month: validMonth(input?.month) }))
  .handler(async ({ data, context }): Promise<WhatsAppStatus> => {
    await assertAdmin(context as never);
    const { monthKeyOf } = await import("./attendance/normalize");
    const { isFinalized } = await import("./scoring/compute.server");
    const { configFromEnv } = await import("./whatsapp/send");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const key = monthKeyOf(data.month)!;
    const [emp, sent] = await Promise.all([
      db.from("employees").select("id, name, role, phone, status").order("id"),
      db.from("whatsapp_deliveries").select("employee_id, status, error, sent_at").eq("month_key", key),
    ]);
    if (emp.error) throw new Error(emp.error.message);
    if (sent.error) throw new Error(sent.error.message);
    const byId = new Map<string, any>((sent.data ?? []).map((r: any) => [r.employee_id, r]));
    const cfg = configFromEnv();
    return {
      month: data.month,
      finalized: Boolean(await isFinalized(key)),
      configured: cfg !== null,
      sendingEnabled: Boolean(cfg?.enabled),
      testMode: Boolean(cfg?.testTo),
      template: cfg?.template ?? "monthly_report_card",
      rows: (emp.data ?? [])
        .filter((e: any) => String(e.status).toLowerCase() !== "inactive")
        .map((e: any): WhatsAppRow => {
          const d = byId.get(e.id);
          return {
            employeeId: e.id,
            name: e.name,
            role: e.role,
            phone: e.phone ?? null,
            status: d ? d.status : "pending",
            error: d?.error ?? null,
            sentAt: d?.sent_at ?? null,
          };
        }),
    };
  });

/** Send (or retry) the WhatsApp report cards for a finalized month. Anyone already sent is skipped. */
export const sendWhatsAppReports = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { month: string }) => ({ month: validMonth(input?.month) }))
  .handler(async ({ data, context }): Promise<{ status: string; error: string | null }> => {
    const email = await assertAdmin(context as never);
    const { monthKeyOf } = await import("./attendance/normalize");
    const { isFinalized } = await import("./scoring/compute.server");
    const key = monthKeyOf(data.month)!;
    if (!(await isFinalized(key))) {
      throw new Error("Finalize the month first: the report cards are sent from the locked reports.");
    }
    const { enqueue, getJob } = await import("./jobs/queue.server");
    const { runWorker } = await import("./jobs/worker.server");
    const job = await enqueue("report.whatsapp", { monthKey: key }, { createdBy: email });
    await runWorker({ jobId: job.id, budgetMs: 40_000 });
    const done = await getJob(job.id);
    return { status: done?.status ?? "queued", error: done?.error ?? null };
  });
