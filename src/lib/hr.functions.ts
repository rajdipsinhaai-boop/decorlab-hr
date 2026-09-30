import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { AccessUser, ControlRow, DashboardView, ViewerRole } from "./hr-types";

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
  .handler(async ({ context }): Promise<DashboardView> => {
    const { role, employeeId, employeeName } = await assertAllowed(context as never);
    const { loadDashboard } = await import("./hr.server");
    const data = await loadDashboard();
    if (role === "manager") {
      const own =
        data.employees.find(
          (e) =>
            (employeeId && e.id === employeeId) ||
            (employeeName && e.name.toLowerCase() === employeeName.toLowerCase()),
        ) ?? null;
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
        data.employees.find(
          (e) =>
            (employeeId && e.id === employeeId) ||
            (employeeName && e.name.toLowerCase() === employeeName.toLowerCase()),
        ) ?? null;
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
      .select("id, email, role, employee_id, employee_name, created_at")
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
      createdAt: row.created_at,
    }));
  });

export const saveAccessUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { email: string; role: ViewerRole; employeeId?: string; employeeName?: string }) => {
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
        },
        { onConflict: "email" },
      )
      .select("id, email, role, employee_id, employee_name, created_at")
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

export const createReportRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { month: string }) => {
    return { month: validMonth(input?.month) };
  })
  .handler(async ({ data, context }): Promise<{ requestId: string }> => {
    const email = await assertLeadership(context as never);
    const { appendRow } = await import("./sheets.server");
    const requestId = crypto.randomUUID();
    await appendRow(CONTROL_RANGE, [
      requestId,
      utcStamp(),
      email,
      data.month,
      "PENDING",
      "",
      "",
      "Create Report",
    ]);
    return { requestId };
  });

export const getReportStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { requestId: string }) => {
    if (!input?.requestId) throw new Error("A request id is required.");
    return { requestId: input.requestId };
  })
  .handler(async ({ data, context }): Promise<ControlRow | null> => {
    await assertAllowed(context as never);
    const { loadControlRows } = await import("./hr.server");
    const rows = await loadControlRows();
    return rows.find((r) => r.requestId === data.requestId) ?? null;
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

export const uploadAttendance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: UploadInput) => validateUpload(input, ".pdf"))
  .handler(async ({ data, context }): Promise<{ requestId: string; driveLink: string }> => {
    const { email } = await assertUploader(context as never);
    const { findOrCreateFolder, uploadFile } = await import("./drive.server");
    const { appendRow } = await import("./sheets.server");

    const folderId = await findOrCreateFolder(`${data.month} - Attendance Uploads`);
    const driveLink = await uploadFile({
      folderId,
      filename: data.filename,
      mimeType: "application/pdf",
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
      "Attendance Upload",
    ]);
    return { requestId, driveLink };
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
    await assertAllowed(context as never);
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
  rating_1_to_5: number;
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
      rating1To5: number;
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
      if (!Number.isFinite(input.rating1To5) || input.rating1To5 < 0 || input.rating1To5 > 5) {
        throw new Error("Rating must be a number from 0 to 5.");
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
        rating1To5: Math.round(input.rating1To5 * 100) / 100,
        weightedScore: input.weightedScore ?? null,
        sourceTab: (input.sourceTab ?? "").trim(),
        notes: input.notes?.trim() || null,
      };
    },
  )
  .handler(async ({ data, context }): Promise<DirectorRatingDetail> => {
    await assertAdmin(context as never);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
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
    return row as DirectorRatingDetail;
  });
