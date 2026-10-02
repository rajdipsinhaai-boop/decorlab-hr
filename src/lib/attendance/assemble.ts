import {
  AttendanceParseError,
  type ParsedDay,
  type ParsedPerson,
  type ParsedReport,
} from "./types";
import { KNOWN_HALF_CODES } from "./normalize";

/**
 * Shared by every file-format parser: validates the rows, de-duplicates and reports
 * anything unusual as a warning so nothing is dropped or guessed silently.
 */
export function assembleReport(input: {
  format: ParsedReport["format"];
  periodStart: string | null;
  periodEnd: string | null;
  runBy: string | null;
  days: ParsedDay[];
  warnings?: string[];
}): ParsedReport {
  const warnings = [...(input.warnings ?? [])];
  if (!input.days.length) {
    throw new AttendanceParseError(
      "No attendance rows were found. Upload the biometric 'Organization-Wise Attendance' report (PDF or Excel).",
    );
  }

  const sorted = input.days.map((d) => d.workDate).sort();
  let periodStart = input.periodStart;
  let periodEnd = input.periodEnd;
  if (!periodStart || !periodEnd) {
    periodStart = sorted[0]!;
    periodEnd = sorted[sorted.length - 1]!;
    warnings.push("The report title has no date range; the period was taken from the rows themselves.");
  }

  // One row per person per day: a repeat means the file was stitched together or exported twice.
  const byKey = new Map<string, ParsedDay>();
  let duplicates = 0;
  for (const d of input.days) {
    const key = `${d.workDate}|${d.cosecId}`;
    if (byKey.has(key)) duplicates++;
    byKey.set(key, d);
  }
  if (duplicates) {
    warnings.push(`${duplicates} duplicate person/day row(s) were found; the last one of each was kept.`);
  }
  const days = [...byKey.values()].sort(
    (a, b) => a.workDate.localeCompare(b.workDate) || a.cosecId.localeCompare(b.cosecId),
  );

  const outside = days.filter((d) => d.workDate < periodStart! || d.workDate > periodEnd!);
  if (outside.length) {
    warnings.push(`${outside.length} row(s) fall outside the printed period ${periodStart} to ${periodEnd}.`);
  }

  const unknown = new Set<string>();
  for (const d of days) {
    for (const code of [d.firstHalf, d.secondHalf]) {
      if (!KNOWN_HALF_CODES.has(code.toUpperCase())) unknown.add(code || "(blank)");
    }
  }
  if (unknown.size) {
    warnings.push(`Unrecognised attendance code(s): ${[...unknown].join(", ")}. Those days are marked Unknown.`);
  }

  // Each person should appear on every date in the report; gaps usually mean a truncated export.
  const dates = new Set(days.map((d) => d.workDate));
  const people = new Map<string, ParsedPerson>();
  for (const d of days) {
    const p = people.get(d.cosecId) ?? { cosecId: d.cosecId, name: d.name, shift: d.shift, days: 0 };
    p.days++;
    people.set(d.cosecId, p);
  }
  for (const p of people.values()) {
    if (p.days < dates.size) {
      warnings.push(`${p.name} (${p.cosecId}) has ${p.days} of ${dates.size} report days.`);
    }
  }

  return {
    format: input.format,
    periodStart,
    periodEnd,
    runBy: input.runBy,
    days,
    people: [...people.values()].sort((a, b) => a.cosecId.localeCompare(b.cosecId)),
    warnings,
  };
}
