import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { AccessUser, ControlRow, DashboardView, ViewerRole } from "./hr-types";

const CONTROL_RANGE = "Control!A:H";
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_BASE64 = Math.ceil((MAX_BYTES * 4) / 3) + 1024;

function utcStamp() {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

type AccessProfile = { role: ViewerRole; employeeId: string | null; employeeName: string | null };

function configuredProfile(email: string): AccessProfile | null {
  const admins = (process.env.ACCESS_ADMIN_EMAILS ?? "rajdipsinhaai@gmail.com")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (admins.includes(email)) return { role: "admin", employeeId: null, employeeName: null };

  try {
    const profiles = JSON.parse(process.env.ACCESS_PROFILES_JSON ?? "{}").profiles ?? {};
    const profile = profiles[email] ?? (["adey020@gmail.com", "mundigenius@gmail.com"].includes(email) ? { role: "manager" } : null);
    if (!profile) return null;
    const role = profile.role === "admin" || profile.role === "manager" || profile.role === "employee" ? profile.role : null;
    if (!role) return null;
    return {
      role,
      employeeId: typeof profile.employeeId === "string" ? profile.employeeId : null,
      employeeName: typeof profile.employeeName === "string" ? profile.employeeName : null,
    };
  } catch {
    return null;
  }
}

async function assertAllowed(context: {
  supabase: any;
  claims: any;
}): Promise<{ email: string; role: ViewerRole; employeeId: string | null; employeeName: string | null }> {
  const email = (context.claims?.email ?? "").toString().toLowerCase();
  if (!email) throw new Error("No email on this account.");
  const configured = configuredProfile(email);
  if (configured) return { email, ...configured };

  let data: any;
  let error: any;
  ({ data, error } = await context.supabase
    .from("allowed_emails")
    .select("email, role, employee_id, employee_name")
    .ilike("email", email)
    .maybeSingle());
  if (error) {
    ({ data, error } = await context.supabase
      .from("allowed_emails")
      .select("email, role")
      .ilike("email", email)
      .maybeSingle());
  }
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Your account is not on the Decorlab HR access list.");
  const role = data.role === "leadership" || data.role === "admin" ? "admin" : data.role === "manager" ? "manager" : "employee";
  return { email, role, employeeId: data.employee_id ?? null, employeeName: data.employee_name ?? null };
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

export const getDashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DashboardView> => {
    const { role, employeeId, employeeName } = await assertAllowed(context as never);
    const { loadDashboard } = await import("./hr.server");
    const data = await loadDashboard();
    if (role === "manager") {
      const own = data.employees.find((e) =>
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
      const employee = data.employees.find((e) =>
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
  .inputValidator((input: { email: string; role: ViewerRole; employeeId?: string; employeeName?: string }) => {
    const email = (input?.email ?? "").trim().toLowerCase();
    if (!email || !email.includes("@") || email.length > 200) throw new Error("Enter a valid email.");
    if (!["admin", "manager", "employee"].includes(input.role)) throw new Error("Choose a valid role.");
    return {
      email,
      role: input.role,
      employeeId: input.employeeId?.trim() || null,
      employeeName: input.employeeName?.trim() || null,
    };
  })
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
    if (!email || !email.includes("@") || email.length > 200) throw new Error("Enter a valid email.");
    return { email };
  })
  .handler(async ({ data, context }): Promise<{ email: string; confirmed: boolean }> => {
    await assertAdmin(context as never);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: users, error: listError } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (listError) throw new Error(listError.message);
    const user = users.users.find((candidate) => candidate.email?.toLowerCase() === data.email);
    if (!user) throw new Error("No account exists for this email yet.");
    const { error } = await supabaseAdmin.auth.admin.updateUserById(user.id, { email_confirm: true });
    if (error) throw new Error(error.message);
    return { email: data.email, confirmed: true };
  });

export const createReportRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { month: string }) => {
    if (!input?.month || typeof input.month !== "string" || input.month.length > 60) {
      throw new Error("A valid month is required.");
    }
    return { month: input.month };
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
  if (!input?.month || typeof input.month !== "string" || input.month.length > 60) {
    throw new Error("A valid month is required.");
  }
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
    const { email } = await assertAllowed(context as never);
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
    const { email } = await assertAllowed(context as never);
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