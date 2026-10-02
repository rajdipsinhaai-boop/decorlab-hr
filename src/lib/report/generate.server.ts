import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { monthLabel } from "../attendance/normalize";
import { loadDashboard } from "../hr.server";
import { PermanentJobError, type Job } from "../jobs/queue.server";
import { modelFor } from "./model-for";
import { buildReportCardPdf } from "./report-card.server";

export const REPORT_BUCKET = "report-cards";

export const reportPath = (monthKey: string, employeeId: string) => `${monthKey}/${employeeId}.pdf`;

/** Worker handler: builds every employee's report card for a month and stores the PDFs. */
export async function runReportGeneration(job: Job): Promise<Record<string, unknown>> {
  const monthKey = String(job.payload["monthKey"] ?? "");
  const label = monthLabel(monthKey);
  const dashboard = await loadDashboard(label);
  if (dashboard.month !== label) throw new PermanentJobError(`There is no data for ${label}.`);

  const people = dashboard.employees;
  let stored = 0;
  const failures: string[] = [];
  for (const [i, e] of people.entries()) {
    try {
      const bytes = await buildReportCardPdf(modelFor(e, label), {
        index: i + 1,
        total: people.length,
        evidence: { days: e.days, dpr: e.dprActivity },
      });
      const { error } = await supabaseAdmin.storage.from(REPORT_BUCKET).upload(reportPath(monthKey, e.id), bytes, {
        contentType: "application/pdf",
        upsert: true,
      });
      if (error) throw new Error(error.message);
      stored++;
    } catch (err) {
      failures.push(`${e.name}: ${(err as Error).message}`);
    }
  }
  if (!stored) throw new Error(`No report cards could be stored. ${failures[0] ?? ""}`);
  return { month: label, stored, failed: failures.length, failures: failures.slice(0, 5) };
}
