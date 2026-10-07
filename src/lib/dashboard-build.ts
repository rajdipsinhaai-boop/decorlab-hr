import { monthKeyOf, monthKeysBetween, monthLabel } from "./attendance/normalize";
import { onProbation, probationEnd, summarizeMonth, TARGET_HOURS } from "./attendance/metrics";
import { DEFAULT_DUTY_RULES, hhmm, KRA_NOT_APPLICABLE } from "./scoring/constants";
import type { DutyRule } from "./scoring/types";
import {
  ragOf,
  type AttendanceDay,
  type BreakdownSegment,
  type CriterionRating,
  type DashboardData,
  type DprActivityEntry,
  type Employee,
  type MonthInfo,
  type Rag,
  type RoleGroup,
  type ScoreCardModel,
  type TrendPoint,
} from "./hr-types";

// Row shapes exactly as they come out of the database (snake_case).
export interface MonthRow {
  month_key: string;
  has_attendance: boolean;
  has_scores: boolean;
}
export interface EmployeeRow {
  id: string;
  name: string;
  role: string;
  role_group: string;
  department: string | null;
  manager: string | null;
  join_date: string | null;
  status: string | null;
}
export interface AttendanceRow {
  employee_id: string;
  work_date: string;
  status: string;
  in_at: string | null;
  out_at: string | null;
  work_min: number | null;
}
export interface ScoreRow {
  month_key: string;
  employee_id: string;
  final_score: number | string | null;
  rag: string | null;
  rank_in_role: number | null;
  overall_rank: number | null;
  is_top3: boolean;
  breakdown: BreakdownSegment[];
  criteria: CriterionRating[];
  note: string;
  details: {
    filing_discipline_pct?: number | null;
    dpr_days?: DprActivityEntry[];
    card?: ScoreCardModel;
  } | null;
  source: string;
}
export interface RatingRow {
  employee_id: string;
  kra_parameter: string;
  weight: number | string | null;
  rating_1_to_5: number | string;
}
export interface Narrative {
  month: string;
  scoreBuilt: string[];
  whyScore: string[];
  improveNextMonth: string[];
}

export interface MonthPlan {
  monthKey: string;
  /** Every month from the first one on record to the present, newest first. */
  keys: string[];
  info: MonthInfo[];
}

/**
 * Picks the month to show and lists every month from the first on record to now.
 * With no (or an unknown) month asked for, the newest month that has data wins.
 */
export function planMonths(rows: MonthRow[], requested: string | undefined, nowKey: string): MonthPlan {
  const byKey = new Map(rows.map((r) => [r.month_key, r]));
  const sorted = rows.map((r) => r.month_key).sort();
  const first = sorted[0] ?? nowKey;
  const last = sorted[sorted.length - 1] ?? nowKey;
  const keys = monthKeysBetween(first < nowKey ? first : nowKey, last > nowKey ? last : nowKey).reverse();
  const asked = requested ? monthKeyOf(requested) : null;
  return {
    monthKey: asked && keys.includes(asked) ? asked : (sorted[sorted.length - 1] ?? nowKey),
    keys,
    info: keys.map((k) => ({
      month: monthLabel(k),
      hasAttendance: byKey.get(k)?.has_attendance ?? false,
      hasScores: byKey.get(k)?.has_scores ?? false,
    })),
  };
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function toAttendanceDay(r: AttendanceRow): AttendanceDay {
  const [y, m, d] = r.work_date.split("-").map(Number) as [number, number, number];
  const clock = (v: string | null) => (v ? v.slice(11, 16) : "");
  return {
    date: `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`,
    day: WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] ?? "",
    status: r.status,
    inTime: clock(r.in_at),
    outTime: clock(r.out_at),
    hours: r.work_min ? Math.round((r.work_min / 60) * 100) / 100 : 0,
  };
}

function reportCardNarrative(
  snapshot: Narrative | undefined,
  breakdown: BreakdownSegment[],
  score: number,
  rag: Rag,
  month: string,
  presentDays: number,
  absentDays: number,
): { scoreBuilt: string[]; whyScore: string[]; improveNextMonth: string[] } {
  const scoreBuilt = snapshot?.scoreBuilt.length
    ? snapshot.scoreBuilt
    : [
        ...breakdown.map(
          (segment) =>
            `${segment.label} (weight ${segment.weight}%) ${segment.score}% → ${segment.contribution} pts.`,
        ),
        `Final score: ${score}% (${rag}) for ${month}.`,
      ];
  const whyScore = snapshot?.whyScore.length
    ? snapshot.whyScore
    : [
        `This score is calculated from the weighted sections shown above.`,
        `Attendance record: ${presentDays} present day(s) and ${absentDays} absent day(s).`,
      ];
  const improveNextMonth = snapshot?.improveNextMonth.length
    ? snapshot.improveNextMonth
    : [
        rag === "RED"
          ? "Focus first on the lowest weighted section and agree on one measurable corrective action with your manager."
          : rag === "YELLOW"
            ? "Choose one weighted section to improve next month and review the target with your manager."
            : "Maintain the current standard and agree on one stretch improvement for the next review month.",
      ];
  return { scoreBuilt, whyScore, improveNextMonth };
}

export interface DashboardInput {
  plan: MonthPlan;
  employees: EmployeeRow[];
  attendance: AttendanceRow[];
  scores: ScoreRow[];
  ratings: RatingRow[];
  /** month_key + final_score of every scored person, for the company trend line. */
  trend: { month_key: string; final_score: number | string }[];
  /** Hand-written report-card text, keyed by lowercase employee name. */
  narratives: Record<string, Narrative>;
  locked?: { at: string; by: string } | null;
  /** Duty rules per role (start time, grace, full-day hours); the agreed defaults when omitted. */
  rules?: Record<RoleGroup, DutyRule>;
}

/** Assembles the dashboard for one month from plain database rows. No I/O, so it is unit-testable. */
export function assembleDashboard(input: DashboardInput): DashboardData {
  const { plan } = input;
  const label = monthLabel(plan.monthKey);
  const scores = new Map(input.scores.map((s) => [s.employee_id, s]));

  const daysByEmployee = new Map<string, AttendanceRow[]>();
  for (const r of input.attendance) {
    const list = daysByEmployee.get(r.employee_id) ?? [];
    list.push(r);
    daysByEmployee.set(r.employee_id, list);
  }
  const ratingsByEmployee = new Map<string, CriterionRating[]>();
  for (const r of input.ratings) {
    const list = ratingsByEmployee.get(r.employee_id) ?? [];
    list.push({ name: r.kra_parameter, weight: Number(r.weight ?? 0), rating: Number(r.rating_1_to_5) });
    ratingsByEmployee.set(r.employee_id, list);
  }

  // A month that has data shows only the people who appear in it (someone who joined later must
  // not show up in earlier months). A month with no data at all shows the whole current roster.
  const monthHasData = plan.info.some((m) => m.month === label && (m.hasAttendance || m.hasScores));

  const employees: Employee[] = [];
  for (const e of input.employees) {
    if (String(e.status).toLowerCase() === "inactive") continue;
    // Probation has no paid leave: leave days show (and count) as absent. Sundays stay off.
    const probation = onProbation(e.join_date, plan.monthKey);
    const skip = new Set(KRA_NOT_APPLICABLE[e.id] ?? []);
    const records = (daysByEmployee.get(e.id) ?? [])
      .map((r) => (probation && r.status === "Leave" ? { ...r, status: "Absent" } : r))
      .sort((a, b) => a.work_date.localeCompare(b.work_date));
    if (monthHasData && !records.length && !scores.has(e.id)) continue;
    const metrics = summarizeMonth(
      records.map((r) => ({
        workDate: r.work_date,
        status: r.status,
        inAt: r.in_at,
        outAt: r.out_at,
        workMin: r.work_min,
      })),
      (input.rules ?? DEFAULT_DUTY_RULES)[e.role_group as RoleGroup].startMin,
    );
    const s = scores.get(e.id);
    const score = s && s.final_score !== null ? Math.round(Number(s.final_score) * 10) / 10 : null;
    const rag: Rag | null = score === null ? null : ((s?.rag as Rag | null) ?? ragOf(score));
    const breakdown = s?.breakdown ?? [];
    const card = input.narratives[e.name.toLowerCase()];

    const narrative =
      score !== null && rag !== null && !s?.details?.card
        ? reportCardNarrative(
            card?.month === label ? card : undefined,
            breakdown,
            score,
            rag,
            label,
            metrics.presentDays,
            metrics.absentDays,
          )
        : null;

    employees.push({
      id: e.id,
      name: e.name,
      role: e.role,
      roleGroup: e.role_group as RoleGroup,
      department: e.department ?? "",
      manager: e.manager ?? "",
      joinDate: e.join_date ?? "",
      ...(probation && e.join_date ? { probationEnds: probationEnd(e.join_date) } : {}),
      score,
      rag,
      rankInRole: s?.rank_in_role ?? null,
      overallRank: s?.overall_rank ?? null,
      isTop3: Boolean(s?.is_top3),
      breakdown,
      criteria: (s?.criteria?.length ? s.criteria : (ratingsByEmployee.get(e.id) ?? [])).filter((c) => !skip.has(c.name)),
      note: s?.note ?? "",
      presentDays: metrics.presentDays,
      totalHours: metrics.totalHours,
      absentDays: metrics.absentDays,
      leaveDays: metrics.leaveDays,
      hasAttendance: records.length > 0,
      avgHours: metrics.avgHours,
      punctualityDeviation: metrics.punctualityDeviation,
      days: records.map(toAttendanceDay),
      filingDiscipline: s?.details?.filing_discipline_pct ?? null,
      dprActivity: s?.details?.dpr_days ?? [],
      taskActivity: [],
      ...(s?.details?.card ? { card: { ...s.details.card, kra: s.details.card.kra.filter((k) => !skip.has(k.name)) } } : {}),
      ...(s?.source ? { scoreSource: s.source } : {}),
      ...(narrative
        ? {
            reportCard: {
              month: label,
              ...narrative,
              downloadPath: `/api/report-card?name=${encodeURIComponent(e.name)}&month=${encodeURIComponent(label)}`,
            },
          }
        : {}),
    });
  }

  const sums = new Map<string, { total: number; n: number }>();
  for (const r of input.trend) {
    const cur = sums.get(r.month_key) ?? { total: 0, n: 0 };
    cur.total += Number(r.final_score);
    cur.n++;
    sums.set(r.month_key, cur);
  }
  const trend: TrendPoint[] = [...sums.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => ({ month: monthLabel(k), average: Math.round((v.total / v.n) * 10) / 10, scored: v.n }));

  const rules = input.rules ?? DEFAULT_DUTY_RULES;
  return {
    month: label,
    locked: input.locked ?? null,
    months: plan.keys.map(monthLabel),
    monthInfo: plan.info,
    trend,
    targetHours: TARGET_HOURS,
    scheduledStart: `${hhmm(rules.designer.startMin)} designers & EA, ${hhmm(rules.supervisor.startMin)} supervisors`,
    employees,
  };
}
