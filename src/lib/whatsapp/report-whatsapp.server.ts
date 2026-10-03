import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { monthLabel } from "../attendance/normalize";
import { PermanentJobError, type Job } from "../jobs/queue.server";
import { REPORT_BUCKET, reportPath } from "../report/generate.server";
import { configFromEnv, normalizePhone, reportComponents, sendTemplate } from "./send";

const db = () => supabaseAdmin as any;
const LINK_SECONDS = 7 * 24 * 3600;

/**
 * Worker handler: sends each employee their stored report card PDF with the approved WhatsApp
 * template. One row per person per month in whatsapp_deliveries, so a retry (or reopening and
 * finalizing again) never messages someone who already received it.
 * Nothing is sent unless WHATSAPP_SEND_ENABLED=true; otherwise it only reports what it would send.
 */
export async function runReportWhatsApp(job: Job): Promise<Record<string, unknown>> {
  const monthKey = String(job.payload["monthKey"] ?? "");
  const cfg = configFromEnv();
  if (!cfg) {
    throw new PermanentJobError(
      "WhatsApp is not configured: set GROWBRO_CLIENT_ID, GROWBRO_CLIENT_SECRET and GROWBRO_AI_ID.",
    );
  }
  const label = monthLabel(monthKey);

  const [emp, done] = await Promise.all([
    db().from("employees").select("id, name, phone, status").order("id"),
    db().from("whatsapp_deliveries").select("employee_id").eq("month_key", monthKey).eq("status", "sent"),
  ]);
  if (emp.error) throw new Error(emp.error.message);
  if (done.error) throw new Error(done.error.message);
  const already = new Set((done.data ?? []).map((r: any) => r.employee_id));

  const out = { sent: 0, skipped: 0, wouldSend: 0, failed: [] as string[] };
  for (const e of emp.data ?? []) {
    if (String(e.status).toLowerCase() === "inactive" || already.has(e.id)) {
      out.skipped++;
      continue;
    }
    const to = normalizePhone(e.phone);
    const record = (status: "sent" | "failed", error: string | null, response: string | null) =>
      db()
        .from("whatsapp_deliveries")
        .upsert(
          { month_key: monthKey, employee_id: e.id, to_number: to, status, error, response, sent_at: new Date().toISOString() },
          { onConflict: "month_key,employee_id" },
        );

    if (!to) {
      await record("failed", "No usable phone number on file.", null);
      out.failed.push(`${e.name}: no phone number`);
      continue;
    }
    const { data: signed, error: signError } = await supabaseAdmin.storage
      .from(REPORT_BUCKET)
      .createSignedUrl(reportPath(monthKey, e.id), LINK_SECONDS);
    if (signError || !signed?.signedUrl) {
      await record("failed", `No stored report PDF: ${signError?.message ?? "missing"}`, null);
      out.failed.push(`${e.name}: no stored PDF`);
      continue;
    }
    if (!cfg.enabled) {
      out.wouldSend++;
      continue;
    }
    try {
      const res = await sendTemplate(cfg, {
        to,
        idempotencyKey: `report-${monthKey}-${e.id}`,
        components: reportComponents({
          name: e.name,
          month: label,
          pdfUrl: signed.signedUrl,
          filename: `${e.name} - ${label} Report Card.pdf`,
        }),
      });
      if (res.ok) {
        await record("sent", null, res.body);
        out.sent++;
      } else {
        await record("failed", `HTTP ${res.status}`, res.body);
        out.failed.push(`${e.name}: HTTP ${res.status} ${res.body.slice(0, 120)}`);
      }
    } catch (err) {
      await record("failed", (err as Error).message, null);
      out.failed.push(`${e.name}: ${(err as Error).message}`);
    }
  }
  // A failure retries the job; people already sent are skipped next time.
  if (out.failed.length) {
    throw new Error(`WhatsApp failed for ${out.failed.length}: ${out.failed.slice(0, 3).join("; ")}`);
  }
  return { month: label, ...out, dryRun: !cfg.enabled };
}
