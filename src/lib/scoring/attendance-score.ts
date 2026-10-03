import { ATTENDED_STATUSES } from "../attendance/types";
import { DESIGNER_VISIBILITY_FLOOR, GRADE_SCORE } from "./constants";
import type { AttDay, AuditPerson, DutyRule, RoleGroup } from "./types";

const round1 = (n: number) => Math.round(n * 10) / 10;
const attended = (s: string) => (ATTENDED_STATUSES as readonly string[]).includes(s);

/** Accepts YYYY-MM-DD or dd/mm/yyyy and returns YYYY-MM-DD ("" if it is neither). */
export function isoDate(v: string): string {
  const t = v.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  return m ? `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}` : "";
}

export interface AttendanceHours {
  attendedDays: number;
  attendedDates: string[];
  workedHours: number;
  /** Working days x the full duty (8h30). */
  expectedHours: number;
  /** Average hours on the attended days that have hours recorded. */
  avgHours: number;
  /** Attended days with hours recorded that ended short of the full duty, and the average shortfall. */
  shortDays: number;
  avgShortMin: number;
  /** Hours beyond the full duty on days that ran over (already part of workedHours). */
  overtimeHours: number;
  raw: number; // 0-100, one decimal
}

/**
 * Raw attendance = hours worked / (working days x 8h30), capped at 100%.
 * Holidays and Sundays are already out of the working days. Late arrival costs nothing by itself;
 * only the hours count, so a late start made up in full scores the same as an on-time one, and
 * overtime on one day can cover a short day in the same month. Only days attended count, and a day
 * with no hours recorded (missing punch) adds none.
 */
export function attendanceHours(days: AttDay[], workingDays: number, rule: DutyRule): AttendanceHours {
  const here = days.filter((d) => attended(d.status));
  const workedMin = here.reduce((a, d) => a + Math.max(0, d.workMin ?? 0), 0);
  const expectedMin = workingDays * rule.requiredMin;

  const withHours = here.filter((d) => (d.workMin ?? 0) > 0);
  const short = withHours.filter((d) => (d.workMin ?? 0) < rule.requiredMin);
  const raw = here.length && expectedMin > 0 ? Math.min(100, (workedMin / expectedMin) * 100) : 0;
  return {
    attendedDays: here.length,
    attendedDates: [...new Set(here.map((d) => d.workDate))].sort(),
    workedHours: round1(workedMin / 60),
    expectedHours: round1(expectedMin / 60),
    avgHours: withHours.length ? round1(workedMin / 60 / withHours.length) : 0,
    shortDays: short.length,
    avgShortMin: short.length
      ? Math.round(short.reduce((a, d) => a + rule.requiredMin - (d.workMin ?? 0), 0) / short.length)
      : 0,
    overtimeHours: round1(
      withHours.reduce((a, d) => a + Math.max(0, (d.workMin ?? 0) - rule.requiredMin), 0) / 60,
    ),
    raw: round1(raw),
  };
}

export interface Visibility {
  /** 0-1 multiplier on raw attendance, or null when it cannot be judged (no penalty applied). */
  factor: number | null;
  visibleDays: number;
  presentDays: number;
  basis: "dpr" | "activity" | "none";
}

/**
 * A day counts as visible only if the person was present AND left a real update that same day.
 *  - supervisors: a DPR that is not a blank template (matched per day, so a report filed on a day
 *    off does not offset a missing one)
 *  - designers / EA: any Rdash activity that day, never penalised below the floor, and only when the
 *    audit actually supplied activity days
 */
export function visibility(role: RoleGroup, attendedDates: string[], audit: AuditPerson | null): Visibility {
  const presentDays = attendedDates.length;
  const none: Visibility = { factor: null, visibleDays: 0, presentDays, basis: "none" };
  if (!audit) return none;

  if (role === "supervisor") {
    const real = new Set(audit.dprDays.filter((d) => !d.blank).map((d) => isoDate(d.date)));
    const visibleDays = attendedDates.filter((d) => real.has(d)).length;
    return {
      factor: presentDays ? Math.min(1, visibleDays / presentDays) : 1,
      visibleDays,
      presentDays,
      basis: "dpr",
    };
  }
  if (audit.activityDays === null) return none;
  const active = new Set(audit.activityDays.map(isoDate));
  const visibleDays = attendedDates.filter((d) => active.has(d)).length;
  return {
    factor: presentDays ? Math.max(DESIGNER_VISIBILITY_FLOOR, Math.min(1, visibleDays / presentDays)) : 1,
    visibleDays,
    presentDays,
    basis: "activity",
  };
}

export interface DprStats {
  filingDays: number;
  blankDays: number;
  coveragePct: number;
  qualityPct: number;
  combined: number;
}

/** Coverage = distinct filing days / working days (blank templates still count as filed). */
export function dprStats(audit: AuditPerson, workingDays: number): DprStats | null {
  const byDay = new Map<string, AuditPerson["dprDays"][number]>();
  for (const d of audit.dprDays) byDay.set(isoDate(d.date) || d.date, d); // last filing of a day wins

  let filingDays: number;
  let qualityPct: number;
  let coveragePct: number;
  if (byDay.size) {
    filingDays = byDay.size;
    const scores = [...byDay.values()]
      .map((d) => d.score ?? GRADE_SCORE[d.grade.trim().toLowerCase()] ?? null)
      .filter((s): s is number => s !== null);
    qualityPct = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
    coveragePct = workingDays ? Math.min(100, (filingDays / workingDays) * 100) : 0;
  } else if (audit.coveragePct !== null && audit.dprQuality !== null) {
    filingDays = audit.dprFilingDays ?? 0;
    qualityPct = audit.dprQuality;
    coveragePct = audit.coveragePct;
  } else {
    return null;
  }
  const blankDays = [...byDay.values()].filter((d) => d.blank).length;
  return {
    filingDays,
    blankDays,
    coveragePct: round1(coveragePct),
    qualityPct: round1(qualityPct),
    combined: round1(coveragePct * 0.4 + qualityPct * 0.6),
  };
}

export interface ManagerStats {
  /** Σ(weight x rating) / 5 as a percentage; an unrated parameter counts as 0, as in the sheet. */
  percent: number;
  average: number;
  rated: number;
  total: number;
  unrated: string[];
  zeros: string[];
  low: string[];
  high: string[];
}

export function managerStats(ratings: { name: string; weight: number; rating: number | null }[]): ManagerStats {
  const totalWeight = ratings.reduce((a, r) => a + r.weight, 0) || 1;
  const weighted = ratings.reduce((a, r) => a + r.weight * (r.rating ?? 0), 0);
  const rated = ratings.filter((r) => r.rating !== null);
  return {
    percent: round1((weighted / totalWeight / 5) * 100),
    average: round1(weighted / totalWeight),
    rated: rated.length,
    total: ratings.length,
    unrated: ratings.filter((r) => r.rating === null).map((r) => r.name),
    zeros: rated.filter((r) => r.rating === 0).map((r) => r.name),
    low: rated.filter((r) => (r.rating ?? 0) > 0 && (r.rating ?? 0) <= 2).map((r) => r.name),
    high: rated.filter((r) => (r.rating ?? 0) >= 4).map((r) => r.name),
  };
}
