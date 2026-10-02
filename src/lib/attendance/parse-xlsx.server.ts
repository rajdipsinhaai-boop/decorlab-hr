import ExcelJS from "exceljs";
import { assembleReport } from "./assemble";
import { dmyToIso, hhmmToMinutes } from "./normalize";
import { AttendanceParseError, type ParsedDay, type ParsedReport } from "./types";

type Cell = string | number | boolean | Date | null;

const TITLE_RE = /From\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+To\s+(\d{1,2}\/\d{1,2}\/\d{4})/i;
const ID_RE = /^[A-Za-z]{0,3}\d+$/;

/** Flattens exceljs rich values (rich text, formulas, hyperlinks) to a plain scalar. */
function scalar(v: unknown): Cell {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date || typeof v === "number" || typeof v === "boolean") return v;
  if (typeof v === "string") return v.trim() === "" ? null : v;
  if (typeof v === "object") {
    const o = v as { richText?: { text: string }[]; result?: unknown; text?: unknown };
    if (o.richText) return scalar(o.richText.map((r) => r.text).join(""));
    if ("result" in o) return scalar(o.result);
    if ("text" in o) return scalar(o.text);
  }
  return null;
}

const text = (v: Cell) => (v === null ? "" : v instanceof Date ? "" : String(v)).replace(/\s+/g, " ").trim();

/** Excel stores clock values as UTC-tagged dates; the UTC fields are the wall-clock the device recorded. */
function wallClock(v: Cell): string | null {
  return v instanceof Date && !Number.isNaN(v.getTime()) ? v.toISOString().slice(0, 19) : null;
}

function dateOnly(v: Cell): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  const m = /^(\d{1,2}\/\d{1,2}\/\d{4})/.exec(text(v));
  return m ? dmyToIso(m[1]!) : null;
}

interface Columns {
  id: number;
  name: number;
  shift: number;
  in: number;
  out: number;
  in2: number;
  out2: number;
  first: number;
  second: number;
  late: number;
  early: number;
  work: number;
  man: number;
  reason: number;
}

/** Finds the columns from the two header rows, so a reordered export still maps correctly. */
function locateColumns(top: Cell[], sub: Cell[]): Columns | null {
  const label = (i: number) => text(top[i] ?? null).toLowerCase();
  const find = (re: RegExp, from = 0) => {
    for (let i = from; i < top.length; i++) if (re.test(label(i))) return i;
    return -1;
  };
  const id = find(/^user$/);
  if (id < 0) return null;
  const ins: number[] = [];
  const outs: number[] = [];
  // A merged header cell (IN- over its SPFID column) repeats its text in every merged column, so
  // only the first column of each run counts.
  top.forEach((_, i) => {
    const startsRun = i === 0 || label(i - 1) !== label(i);
    if (startsRun && /^in-?$/.test(label(i))) ins.push(i);
    if (startsRun && /^out-?$/.test(label(i))) outs.push(i);
  });
  const cols: Columns = {
    id,
    name: find(/^name$/),
    shift: find(/^shift$/),
    in: ins[0] ?? -1,
    in2: ins[1] ?? -1,
    out: outs[0] ?? -1,
    out2: outs[1] ?? -1,
    first: find(/^1st$/),
    second: find(/^2nd$/),
    late: find(/^late$/),
    early: find(/^early$/),
    work: find(/^work$/),
    man: find(/^man$/),
    reason: find(/^reason$/),
  };
  void sub;
  const required: (keyof Columns)[] = ["name", "in", "out", "first", "second", "work"];
  return required.every((k) => cols[k] >= 0) ? cols : null;
}

export async function parseCosecXlsx(bytes: Uint8Array): Promise<ParsedReport> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(bytes as unknown as ArrayBuffer);
  } catch {
    throw new AttendanceParseError("That Excel file could not be opened. Export it again as .xlsx.");
  }
  const ws = wb.worksheets[0];
  if (!ws) throw new AttendanceParseError("The Excel file has no sheets.");

  const grid: Cell[][] = [];
  ws.eachRow({ includeEmpty: true }, (row, n) => {
    grid[n - 1] = (row.values as unknown[]).slice(1).map(scalar);
  });

  let period: { start: string; end: string } | null = null;
  let runBy: string | null = null;
  let headerAt = -1;
  for (let r = 0; r < Math.min(grid.length, 15); r++) {
    const row = grid[r] ?? [];
    for (let c = 0; c < row.length; c++) {
      const t = text(row[c] ?? null);
      const m = TITLE_RE.exec(t);
      if (m && !period) {
        const start = dmyToIso(m[1]!);
        const end = dmyToIso(m[2]!);
        if (start && end) period = { start, end };
      }
      if (/^run by:?$/i.test(t)) runBy = text(row.slice(c + 1).find((x) => x !== null) ?? null) || null;
    }
    if (headerAt < 0 && locateColumns(row, grid[r + 1] ?? [])) headerAt = r;
  }
  if (headerAt < 0) {
    throw new AttendanceParseError(
      "This does not look like the biometric attendance report (no User / Name / 1st Half / Work Hrs header found).",
    );
  }
  const cols = locateColumns(grid[headerAt]!, grid[headerAt + 1] ?? [])!;

  const days: ParsedDay[] = [];
  const warnings: string[] = [];
  let currentDate: string | null = null;
  for (let r = headerAt + 1; r < grid.length; r++) {
    const row = grid[r] ?? [];
    const idCell = row[cols.id] ?? null;
    const asDate = dateOnly(idCell);
    if (asDate && !ID_RE.test(text(idCell))) {
      currentDate = asDate;
      continue;
    }
    const id = text(idCell);
    if (!ID_RE.test(id) || !text(row[cols.name] ?? null)) continue;
    if (!currentDate) {
      warnings.push(`Row ${r + 1} (${id}) appears before any date heading and was skipped.`);
      continue;
    }
    const mins = (c: number) => (c >= 0 ? hhmmToMinutes(text(row[c] ?? null)) : null);
    const reason = text(cols.reason >= 0 ? (row[cols.reason] ?? null) : null);
    days.push({
      workDate: currentDate,
      cosecId: id.toUpperCase(),
      name: text(row[cols.name] ?? null),
      shift: text(cols.shift >= 0 ? (row[cols.shift] ?? null) : null) || null,
      inAt: wallClock(row[cols.in] ?? null),
      outAt: wallClock(row[cols.out] ?? null),
      in2At: cols.in2 >= 0 ? wallClock(row[cols.in2] ?? null) : null,
      out2At: cols.out2 >= 0 ? wallClock(row[cols.out2] ?? null) : null,
      firstHalf: text(row[cols.first] ?? null).toUpperCase(),
      secondHalf: text(row[cols.second] ?? null).toUpperCase(),
      lateInMin: mins(cols.late),
      earlyOutMin: mins(cols.early),
      workMin: mins(cols.work),
      manualEntry: /^y/i.test(text(cols.man >= 0 ? (row[cols.man] ?? null) : null)),
      reason: reason || null,
    });
  }

  return assembleReport({
    format: "xlsx",
    periodStart: period?.start ?? null,
    periodEnd: period?.end ?? null,
    runBy,
    days,
    warnings,
  });
}
