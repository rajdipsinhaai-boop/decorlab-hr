import { claimable, ensureControlColumns, markFailed, markProcessing, readQueue } from "./control.server";

export interface CronResult {
  processed: string[];
  notes: string[];
}

/** One scheduled pass over the Control queue plus the staging-folder syncs. */
export async function runScheduledPass(): Promise<CronResult> {
  const processed: string[] = [];
  const notes: string[] = [];

  await ensureControlColumns();

  const row = claimable(await readQueue())[0];
  if (row) {
    await markProcessing(row);
    try {
      if (row.type === "Create Report") {
        const { processReportRequest } = await import("./report-cards.server");
        processed.push(await processReportRequest(row));
      } else if (row.type === "Attendance Upload") {
        const { processAttendanceUpload } = await import("./attendance-import.server");
        processed.push(await processAttendanceUpload(row));
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

  return { processed, notes };
}