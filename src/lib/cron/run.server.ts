import { claimable, ensureControlColumns, markFailed, markProcessing, readQueue } from "./control.server";

export interface CronResult {
  processed: string[];
  notes: string[];
}

/**
 * One scheduled pass:
 *  1. the database job queue (attendance imports, and anything queued there in future),
 *  2. the Google-Sheet Control queue that still carries report cards and WhatsApp exports.
 * Each part is isolated, so a problem in one never stops the other.
 */
export async function runScheduledPass(): Promise<CronResult> {
  const processed: string[] = [];
  const notes: string[] = [];

  try {
    const { runWorker } = await import("../jobs/worker.server");
    const report = await runWorker({ maxJobs: 10, budgetMs: 40_000 });
    for (const p of report.processed) {
      processed.push(`${p.outcome}: ${p.type} ${p.id}${p.error ? ` (${p.error})` : ""}`);
    }
  } catch (error) {
    console.error("Job worker pass failed:", error);
    notes.push(`job worker failed: ${(error as Error).message}`);
  }

  try {
    await legacyControlPass(processed);
  } catch (error) {
    console.error("Control sheet pass failed:", error);
    notes.push(`control sheet pass failed: ${(error as Error).message}`);
  }

  // The old Google-Sheet automations. Scores no longer depend on them (the DPR evidence now comes from
  // the Claude post and ratings live in the database), so they are off unless explicitly enabled.
  if (process.env["LEGACY_SHEET_JOBS"] === "true") {
    try {
      const { syncActivityLogs } = await import("./activity-logs.server");
      notes.push(...(await syncActivityLogs()));
    } catch (error) {
      console.error("Activity log sync failed:", error);
      notes.push(`activity log sync failed: ${(error as Error).message}`);
    }

    try {
      const { scoreFollowUps } = await import("./followups.server");
      const result = await scoreFollowUps();
      if (result) notes.push(result);
    } catch (error) {
      console.error("Follow-up scoring failed:", error);
      notes.push(`follow-up scoring failed: ${(error as Error).message}`);
    }
  }

  return { processed, notes };
}

async function legacyControlPass(processed: string[]): Promise<void> {
  await ensureControlColumns();

  const row = claimable(await readQueue())[0];
  if (!row) return;
  await markProcessing(row);
  try {
    if (row.type === "Create Report") {
      // Report cards are built by the database job queue now.
      await markFailed(row, "Report cards are now created from the dashboard (database queue). Please press Create Report again.");
      processed.push("failed: legacy report request (use the dashboard)");
    } else if (row.type === "Attendance Upload") {
      // Attendance no longer runs through the sheet. A request left over from the old flow cannot be processed.
      await markFailed(
        row,
        "Attendance uploads now go through the new import pipeline. Please upload the report again from the dashboard.",
      );
      processed.push("failed: legacy attendance request (re-upload needed)");
    } else {
      const { markDone } = await import("./control.server");
      await markDone(row, undefined, "WhatsApp export stored; processed by the external automation.");
      processed.push("done: whatsapp export acknowledged");
    }
  } catch (error) {
    const message = (error as Error).message ?? "Unknown error";
    console.error(`Control row ${row.requestId} failed:`, error);
    await markFailed(row, message);
    processed.push(`failed: ${message}`);
  }
}
