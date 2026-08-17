import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { ControlRow, DashboardView, ViewerRole } from "./hr-types";

const CONTROL_RANGE = "Control!A:H";
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_BASE64 = Math.ceil((MAX_BYTES * 4) / 3) + 1024;

function utcStamp() {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

async function assertAllowed(context: {
  supabase: any;
  claims: any;
}): Promise<{ email: string; role: ViewerRole }> {
  const email = (context.claims?.email ?? "").toString().toLowerCase();
  if (!email) throw new Error("No email on this account.");
  const { data, error } = await context.supabase
    .from("allowed_emails")
    .select("email, role")
    .ilike("email", email)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Your account is not on the Decorlab HR access list.");
  return { email, role: (data.role as ViewerRole) ?? "leadership" };
}

/** Leadership-only surfaces (scores, reports, AI assistant). */
async function assertLeadership(context: { supabase: any; claims: any }): Promise<string> {
  const { email, role } = await assertAllowed(context);
  if (role !== "leadership") {
    throw new Error("Your account does not have access to performance scores.");
  }
  return email;
}

export const getDashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DashboardView> => {
    const { role } = await assertAllowed(context as never);
    const { loadDashboard } = await import("./hr.server");
    const data = await loadDashboard();
    if (role === "manager") {
      // Managers only ever receive names and roles — no scores leave the server.
      return {
        viewerRole: "manager",
        month: data.month,
        months: data.months,
        roster: data.employees.map((e) => ({
          id: e.id,
          name: e.name,
          role: e.role,
          roleGroup: e.roleGroup,
        })),
      };
    }
    return { viewerRole: "leadership", data };
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
    const email = await assertAllowed(context as never);
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
    const email = await assertAllowed(context as never);
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
    const email = await assertAllowed(context as never);
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
    await assertAllowed(context as never);
    const { answerQuestion } = await import("./assistant.server");
    return { answer: await answerQuestion(data.question, data.history) };
  });