import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { ControlRow, DashboardData } from "./hr-types";

async function assertAllowed(context: { supabase: any; claims: any }): Promise<string> {
  const email = (context.claims?.email ?? "").toString().toLowerCase();
  if (!email) throw new Error("No email on this account.");
  const { data, error } = await context.supabase
    .from("allowed_emails")
    .select("email")
    .ilike("email", email)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Your account is not on the Decorlab HR access list.");
  return email;
}

export const getDashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DashboardData> => {
    await assertAllowed(context as never);
    const { loadDashboard } = await import("./hr.server");
    return loadDashboard();
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
    const now = new Date().toISOString().replace("T", " ").slice(0, 19);
    await appendRow("Control!A:G", [requestId, now, email, data.month, "PENDING", "", ""]);
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