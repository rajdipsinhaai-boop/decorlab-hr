import { arrivalMinutes } from "../attendance/metrics";
import { ATTENDED_STATUSES } from "../attendance/types";
import { ATTENDANCE_BLEND, DESIGNER_VISIBILITY_FLOOR, GRADE_SCORE, TARGET_HOURS } from "./constants";
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

export interface AttendanceBlend {
  attendedDays: number;
  /** Attended days counted in full-duty days (a day cut short counts as part of a day). */
  creditDays: number;
  attendedDates: string[];
  avgHours: number;
  presence: number; // 0-1
  hours: number; // 0-1
  punctuality: number; // 0-1
  onTimeDays: number;
  punctualitySample: number;
  /** Attended days with hours recorded that ended short of the full duty, and the average shortfall. */
  shortDays: number;
  avgShortMin: number;
  halfDays: number;
  raw: number; // 0-100, one decimal
}

/**
 * Raw attendance = 70% presence + 20% hours + 10% punctuality.
 *  - presence: full-duty days over working days. A day attended earns credit in proportion to the
 *    hours worked against the 8h30 duty (capped at 1), so a day cut short is only part of a day.
 *    A day with no hours recorded (missing punch) gets full credit: nothing to judge it on.
 *  - hours: average worked hours on attended days against the 8h30 duty, capped at 100%
 *  - punctuality: share of attended days that count as on time: arrived within the grace period of the
 *    start time, OR completed the full 8h30 duty (arriving late is fine if the hours are made up)
 * A part with no usable data (no hours recorded, no readable arrival) is neutral rather than a penalty.
 */
export function attendanceBlend(
  days: AttDay[],
  workingDays: number,
  rule: DutyRule,
): AttendanceBlend {
  const here = days.filter((d) => attended(d.status));
  const credit = (d: AttDay) => ((d.workMin ?? 0) > 0 ? Math.min(1, (d.workMin ?? 0) / rule.requiredMin) : 1);
  const creditDays = here.reduce((a, d) => a + credit(d), 0);
  const presence = workingDays > 0 ? Math.min(1, creditDays / workingDays) : 0;

  const hoursList = here.map((d) => (d.workMin ?? 0) / 60).filter((h) => h > 0);
  const avgHours = hoursList.length ? hoursList.reduce((a, b) => a + b, 0) / hoursList.length : 0;
  const hours = hoursList.length ? Math.min(1, avgHours / TARGET_HOURS) : 1;

  const short = here.filter((d) => (d.workMin ?? 0) > 0 && (d.workMin ?? 0) < rule.requiredMin);
  const avgShortMin = short.length
    ? Math.round(short.reduce((a, d) => a + rule.requiredMin - (d.workMin ?? 0), 0) / short.length)
    : 0;
  let onTimeDays = 0;
  let sample = 0;
  for (const d of here) {
    const arrival = arrivalMinutes({
      workDate: d.workDate,
      status: d.status,
      inAt: d.inAt,
      outAt: null,
      workMin: d.workMin,
    });
    const fullDuty = (d.workMin ?? 0) >= rule.requiredMin;
    if (arrival === null && !fullDuty) continue; // nothing to judge this day on
    sample++;
    if (fullDuty || (arrival !== null && arrival <= rule.startMin + rule.graceMin)) onTimeDays++;
  }
  const punctuality = sample ? onTimeDays / sample : 1;

  // Nobody attended: the neutral hours/punctuality parts would otherwise hand out 30% for a month
  // of absence. The sheet zeroed this too (its J column: IF(present days = 0, 0, ...)).
  const raw = here.length
    ? 100 *
      (ATTENDANCE_BLEND.presence * presence +
        ATTENDANCE_BLEND.hours * hours +
        ATTENDANCE_BLEND.punctuality * punctuality)
    : 0;
  return {
    attendedDays: here.length,
    creditDays: round1(creditDays),
    attendedDates: [...new Set(here.map((d) => d.workDate))].sort(),
    avgHours: round1(avgHours),
    presence,
    hours,
    punctuality,
    onTimeDays,
    punctualitySample: sample,
    shortDays: short.length,
    avgShortMin,
    halfDays: days.filter((d) => d.status === "Half Day").length,
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
