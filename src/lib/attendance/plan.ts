import { resolveIdentity, type MatchContext } from "./match";
import { summarizeMonth, type MonthMetrics } from "./metrics";
import { deriveStatus } from "./normalize";
import type { ParsedDay, ParsedReport } from "./types";

/** One row of public.attendance_records, in the shape import_attendance_records() expects. */
export interface DbRecordRow {
  month_key: string;
  work_date: string;
  cosec_id: string;
  employee_id: string | null;
  raw_name: string;
  shift: string | null;
  in_at: string | null;
  out_at: string | null;
  in2_at: string | null;
  out2_at: string | null;
  first_half: string;
  second_half: string;
  status: string;
  late_in_min: number | null;
  early_out_min: number | null;
  work_min: number | null;
  manual_entry: boolean;
  reason: string | null;
}

export interface PersonOutcome {
  cosecId: string;
  name: string;
  days: number;
  outcome: "matched" | "excluded" | "unmatched";
  employeeId?: string;
  employeeName?: string;
  via?: "cosec_id" | "name" | "alias";
  reason?: string;
  suggestions?: { employeeId: string; name: string }[];
  summary?: MonthMetrics;
}

export interface ImportStats {
  format: "xlsx" | "pdf";
  periodStart: string;
  periodEnd: string;
  runBy: string | null;
  monthKeys: string[];
  rowsInFile: number;
  rowsStored: number;
  rowsExcluded: number;
  rowsUnmatched: number;
  people: PersonOutcome[];
  warnings: string[];
}

export interface ImportPlan {
  rows: DbRecordRow[];
  /** Biometric ids to remember on employees that did not have one yet. */
  learn: { employeeId: string; cosecId: string }[];
  stats: ImportStats;
}

export function toDbRow(d: ParsedDay, employeeId: string | null): DbRecordRow {
  return {
    month_key: d.workDate.slice(0, 7),
    work_date: d.workDate,
    cosec_id: d.cosecId,
    employee_id: employeeId,
    raw_name: d.name,
    shift: d.shift,
    in_at: d.inAt,
    out_at: d.outAt,
    in2_at: d.in2At,
    out2_at: d.out2At,
    first_half: d.firstHalf,
    second_half: d.secondHalf,
    status: deriveStatus(d.firstHalf, d.secondHalf),
    late_in_min: d.lateInMin,
    early_out_min: d.earlyOutMin,
    work_min: d.workMin,
    manual_entry: d.manualEntry,
    reason: d.reason,
  };
}

/** Decides, without touching the database, what an upload will write and who could not be mapped. */
export function planImport(report: ParsedReport, ctx: MatchContext): ImportPlan {
  const names = new Map(ctx.employees.map((e) => [e.id, e.name]));
  const rows: DbRecordRow[] = [];
  const learn: ImportPlan["learn"] = [];
  const people: PersonOutcome[] = [];
  let rowsExcluded = 0;
  let rowsUnmatched = 0;

  for (const person of report.people) {
    const days = report.days.filter((d) => d.cosecId === person.cosecId);
    const res = resolveIdentity({ cosecId: person.cosecId, name: person.name }, ctx);
    const base = { cosecId: person.cosecId, name: person.name, days: days.length };

    if (res.kind === "excluded") {
      rowsExcluded += days.length;
      people.push({ ...base, outcome: "excluded", reason: res.reason });
      continue;
    }
    const employeeId = res.kind === "matched" ? res.employeeId : null;
    const dbRows = days.map((d) => toDbRow(d, employeeId));
    rows.push(...dbRows);

    if (res.kind === "matched") {
      if (res.learnCosecId) learn.push({ employeeId: res.employeeId, cosecId: person.cosecId });
      people.push({
        ...base,
        outcome: "matched",
        employeeId: res.employeeId,
        employeeName: names.get(res.employeeId) ?? res.employeeId,
        via: res.via,
        summary: summarizeMonth(
          dbRows.map((r) => ({
            workDate: r.work_date,
            status: r.status,
            inAt: r.in_at,
            outAt: r.out_at,
            workMin: r.work_min,
          })),
        ),
      });
    } else {
      rowsUnmatched += days.length;
      people.push({ ...base, outcome: "unmatched", reason: res.reason, suggestions: res.suggestions });
    }
  }

  const warnings = [...report.warnings];
  const unknownDays = rows.filter((r) => r.status === "Unknown").length;
  if (unknownDays) warnings.push(`${unknownDays} day(s) have an attendance code that could not be classified.`);

  return {
    rows,
    learn,
    stats: {
      format: report.format,
      periodStart: report.periodStart,
      periodEnd: report.periodEnd,
      runBy: report.runBy,
      monthKeys: [...new Set(rows.map((r) => r.month_key))].sort(),
      rowsInFile: report.days.length,
      rowsStored: rows.length,
      rowsExcluded,
      rowsUnmatched,
      people,
      warnings,
    },
  };
}
