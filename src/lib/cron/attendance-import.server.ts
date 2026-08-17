import { batchGet, batchUpdateValues, appendRows } from "../sheets.server";
import { downloadAsCsv, fileIdFromLink, getFileMeta } from "../drive.server";
import { findCol, headerIndexOf, parseCsv } from "../csv.server";
import { SCHEDULED_START_MINUTES } from "../sheets.server";
import { markDone, markFailed, type QueueRow } from "./control.server";

const cell = (row: string[] | undefined, i: number) => (i >= 0 ? (row?.[i] ?? "").toString().trim() : "");

function toMinutes(t: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(t.trim());
  return m ? parseInt(m[1]!, 10) * 60 + parseInt(m[2]!, 10) : null;
}

function toHours(t: string): number {
  const m = /^(\d{1,2}):(\d{2})/.exec(t.trim());
  if (m) return parseInt(m[1]!, 10) + parseInt(m[2]!, 10) / 60;
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : 0;
}

interface Parsed {
  rows: { date: string; day: string; name: string; status: string; inTime: string; outTime: string; hours: number }[];
}

/**
 * Only structured exports (CSV / Google Sheet) are parsed. A PDF upload is
 * reported as FAILED on purpose: guessed numbers would corrupt real scores.
 */
function parseAttendance(text: string): Parsed | { error: string } {
  const grid = parseCsv(text);
  if (grid.length < 2) return { error: "The uploaded attendance file has no readable rows." };
  const headerIdx = grid.findIndex((r) => /employee/i.test(r.join(" ")) && /status|in.?time|date/i.test(r.join(" ")));
  if (headerIdx < 0) return { error: "Could not find an attendance header row (employee name / date / status)." };
  const map = headerIndexOf(grid[headerIdx]!);
  const i = {
    date: findCol(map, "date"),
    day: findCol(map, "day"),
    name: findCol(map, "employee name", "name"),
    status: findCol(map, "status"),
    inT: findCol(map, "in time", "in-time"),
    outT: findCol(map, "out time", "out-time"),
    hours: findCol(map, "hours worked", "hours"),
  };
  if (i.name < 0 || i.date < 0 || i.status < 0) {
    return { error: "The attendance file is missing employee name, date or status columns." };
  }
  const rows = grid.slice(headerIdx + 1).flatMap((r) => {
    const name = cell(r, i.name);
    if (!name) return [];
    return [
      {
        date: cell(r, i.date),
        day: cell(r, i.day),
        name,
        status: cell(r, i.status),
        inTime: cell(r, i.inT),
        outTime: cell(r, i.outT),
        hours: toHours(cell(r, i.hours)),
      },
    ];
  });
  if (!rows.length) return { error: "No attendance rows were found in the uploaded file." };
  return { rows };
}

export async function processAttendanceUpload(row: QueueRow): Promise<string> {
  const fileId = fileIdFromLink(row.driveLink);
  if (!fileId) {
    await markFailed(row, "No uploaded attendance file could be resolved from the Drive link.");
    return "failed: no file";
  }
  const meta = await getFileMeta(fileId);
  if (/pdf/i.test(meta.mimeType)) {
    await markFailed(
      row,
      "Attendance PDFs cannot be parsed reliably. Please upload a CSV or Google Sheet export with columns: Date, Day, Employee Name, Status, In Time, Out Time, Hours Worked.",
    );
    return "failed: pdf not parseable";
  }

  const parsed = parseAttendance(await downloadAsCsv(meta));
  if ("error" in parsed) {
    await markFailed(row, parsed.error);
    return `failed: ${parsed.error}`;
  }

  // Daily Attendance: append only the rows for this upload (no full-sheet replace).
  await appendRows(
    "Daily Attendance!A:I",
    parsed.rows.map((r) => [r.date, r.day, "", r.name, "", r.status, r.inTime, r.outTime, r.hours || ""]),
  );

  // Raw Data: targeted per-employee cell updates on the existing rows.
  const rawRange = "Raw Data!A3:N200";
  const raw = (await batchGet([rawRange]))[rawRange] ?? [];
  const rawMap = headerIndexOf(raw[0] ?? []);
  const ri = {
    name: findCol(rawMap, "employee name", "name"),
    present: findCol(rawMap, "present days"),
    absent: findCol(rawMap, "absent days"),
    avg: findCol(rawMap, "average hours", "avg hours"),
    dev: findCol(rawMap, "punctuality"),
    dpr: findCol(rawMap, "dpr filing days", "dpr days"),
  };
  if (ri.name < 0) {
    await markFailed(row, "Attendance rows were appended, but the Raw Data tab has no Employee Name column to update.");
    return "failed: raw data layout";
  }

  const letter = (i: number) => String.fromCharCode(65 + i);
  const writes: { range: string; values: (string | number)[][] }[] = [];
  const byName = new Map<string, typeof parsed.rows>();
  for (const r of parsed.rows) {
    byName.set(r.name, [...(byName.get(r.name) ?? []), r]);
  }

  raw.slice(1).forEach((r, idx) => {
    const name = cell(r, ri.name);
    const days = byName.get(name);
    if (!name || !days) return;
    const sheetRow = idx + 4;
    const present = days.filter((d) => /present|incomplete/i.test(d.status));
    const hours = present.map((d) => d.hours).filter((h) => h > 0);
    const devs = present
      .map((d) => toMinutes(d.inTime))
      .filter((m): m is number => m !== null)
      .map((m) => m - SCHEDULED_START_MINUTES);
    const put = (col: number, value: string | number) => {
      if (col >= 0) writes.push({ range: `Raw Data!${letter(col)}${sheetRow}`, values: [[value]] });
    };
    put(ri.present, present.length);
    put(ri.absent, days.filter((d) => /absent/i.test(d.status)).length);
    put(ri.avg, hours.length ? Math.round((hours.reduce((a, b) => a + b, 0) / hours.length) * 10) / 10 : 0);
    put(
      ri.dev,
      devs.length ? Math.round(devs.reduce((a, b) => a + b, 0) / devs.length) : 0,
    );
  });

  await batchUpdateValues(writes);
  await markDone(row, undefined, `${parsed.rows.length} attendance rows imported.`);
  return `done: ${parsed.rows.length} attendance rows`;
}