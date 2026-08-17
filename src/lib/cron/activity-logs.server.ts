import { batchGet, appendRows, ensureTab } from "../sheets.server";
import { downloadAsCsv, findFolder, listFolderFiles } from "../drive.server";
import { findCol, headerIndexOf, parseCsv } from "../csv.server";

export const DPR_TAB = "DPR Activity Log";
export const TASK_TAB = "Task Activity Log";

export const DPR_HEADERS = [
  "Employee Name",
  "Date",
  "Grade",
  "Work Summary",
  "Blockers Noted",
  "Tomorrow's Plan Noted",
  "Month",
];
export const TASK_HEADERS = [
  "Employee Name",
  "Task Name",
  "Status",
  "Assigned Date",
  "Done Date",
  "Revision Count",
  "Notes",
  "Month",
];

const cell = (row: string[] | undefined, i: number) => (i >= 0 ? (row?.[i] ?? "").toString().trim() : "");

function monthFromFilename(name: string, prefix: string): string {
  const m = new RegExp(`${prefix}\\s*-\\s*(.+?)(\\.[a-z]+)?$`, "i").exec(name.trim());
  return (m?.[1] ?? "").trim();
}

function rowsFromCsv(text: string, headers: string[], month: string): (string | number)[][] {
  const grid = parseCsv(text);
  if (grid.length < 2) return [];
  const map = headerIndexOf(grid[0] ?? []);
  const cols = headers.slice(0, -1).map((h) => findCol(map, h.toLowerCase()));
  return grid.slice(1).flatMap((r) => {
    const values = cols.map((c) => cell(r, c));
    if (!values.some((v) => v)) return [];
    return [[...values, month]];
  });
}

/**
 * Pulls the latest "DPR Activity Log - <Month>" / "Task Activity Log - <Month>"
 * files from the Automation Bridge staging folder and appends them to the
 * master tracker, keeping previous months intact.
 */
export async function syncActivityLogs(): Promise<string[]> {
  const notes: string[] = [];
  const bridge = await findFolder("Automation Bridge");
  if (!bridge) return notes;

  const files = await listFolderFiles(bridge);
  const pick = (prefix: string) =>
    files
      .filter((f) => f.name.toLowerCase().startsWith(prefix.toLowerCase()))
      .sort((a, b) => (b.modifiedTime ?? "").localeCompare(a.modifiedTime ?? ""))[0];

  for (const spec of [
    { prefix: "DPR Activity Log", tab: DPR_TAB, headers: DPR_HEADERS },
    { prefix: "Task Activity Log", tab: TASK_TAB, headers: TASK_HEADERS },
  ]) {
    const file = pick(spec.prefix);
    if (!file) continue;
    const month = monthFromFilename(file.name, spec.prefix);
    if (!month) continue;

    await ensureTab(spec.tab, spec.headers);
    const range = `${spec.tab}!A1:Z5000`;
    const existing = (await batchGet([range]))[range] ?? [];
    const monthCol = spec.headers.length - 1;
    const already = existing.slice(1).filter((r) => cell(r, monthCol) === month).length;

    const rows = rowsFromCsv(await downloadAsCsv(file), spec.headers, month);
    if (rows.length > already) {
      await appendRows(`${spec.tab}!A:${String.fromCharCode(65 + monthCol)}`, rows.slice(already));
      notes.push(`${spec.tab}: +${rows.length - already} rows for ${month}`);
    }
  }
  return notes;
}