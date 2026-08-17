import { bytesToBase64, findOrCreateFolder, folderLink, uploadFile } from "../drive.server";
import { loadDashboard } from "../hr.server";
import { buildReportCard } from "./report-pdf.server";
import { markDone, markFailed, type QueueRow } from "./control.server";

function safeName(v: string) {
  return v.replace(/[\\/:*?"<>|]+/g, "-").trim();
}

export async function processReportRequest(row: QueueRow): Promise<string> {
  const dashboard = await loadDashboard();
  const month = row.month || dashboard.month;
  if (!dashboard.employees.length) {
    await markFailed(row, "No employees could be read from the master tracker.");
    return "failed: no employees";
  }

  const folderId = await findOrCreateFolder(`${month} - Report Cards`);
  const link = folderLink(folderId);

  let ok = 0;
  const failures: string[] = [];
  for (const employee of dashboard.employees) {
    try {
      const bytes = await buildReportCard(employee, month);
      await uploadFile({
        folderId,
        filename: `${safeName(employee.name)} - ${safeName(month)} Report Card.pdf`,
        mimeType: "application/pdf",
        base64: bytesToBase64(bytes),
      });
      ok++;
    } catch (error) {
      failures.push(`${employee.name}: ${(error as Error).message}`);
    }
  }

  const total = dashboard.employees.length;
  if (failures.length > total / 2) {
    await markFailed(row, `Only ${ok}/${total} report cards generated. ${failures.slice(0, 3).join(" | ")}`);
    return `failed: ${ok}/${total}`;
  }
  await markDone(row, link, failures.length ? `${failures.length} of ${total} failed: ${failures[0]}` : "");
  return `done: ${ok}/${total} report cards in "${month} - Report Cards"`;
}