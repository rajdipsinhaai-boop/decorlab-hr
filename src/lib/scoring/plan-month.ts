import { holidayDates, onProbation, workingDaysInMonth } from "../attendance/metrics";
import { monthLabel } from "../attendance/normalize";
import { rankMonth, computeScore } from "./engine";
import { buildScoreCard } from "./score-card";
import type { AttDay, AuditPerson, DutyRule, RatingIn, RoleGroup, ScoreCardModel } from "./types";

export interface MonthEmployee {
  id: string;
  name: string;
  role: string;
  role_group: RoleGroup;
  join_date?: string | null;
}
export interface KraParam {
  role_group: RoleGroup;
  name: string;
  weight: number;
  sort: number;
}
export interface RatingRow {
  employee_id: string;
  kra_parameter: string;
  weight: number | null;
  rating_1_to_5: number | null;
}

export interface MonthData {
  monthKey: string;
  employees: MonthEmployee[];
  attendance: (AttDay & { employeeId: string })[];
  ratings: RatingRow[];
  params: KraParam[];
  audit: Map<string, AuditPerson>;
  claudeScores?: Map<string, number>;
  rules: Record<RoleGroup, DutyRule>;
  /** Official holiday dates (YYYY-MM-DD) from the holiday calendar. */
  holidays?: string[];
  /** Yearly warnings each person used in OTHER months of this year. */
  warningsUsed?: Map<string, number>;
  now?: Date;
}

/** One row of public.monthly_scores. */
export interface ScoreRowOut {
  month_key: string;
  employee_id: string;
  final_score: number | null;
  rag: string | null;
  rank_in_role: number | null;
  overall_rank: number | null;
  is_top3: boolean;
  breakdown: { label: string; weight: number; score: number; contribution: number; note: string }[];
  criteria: { name: string; weight: number; rating: number; rated: boolean }[];
  note: string;
  details: Record<string, unknown>;
  source: "computed";
}

/** The rating list for a person: the role's KRA parameters, with whatever has been rated so far. */
export function ratingsFor(
  e: MonthEmployee,
  params: KraParam[],
  rows: RatingRow[],
): RatingIn[] {
  const mine = new Map(rows.filter((r) => r.employee_id === e.id).map((r) => [r.kra_parameter, r]));
  const defined = params
    .filter((p) => p.role_group === e.role_group)
    .sort((a, b) => a.sort - b.sort)
    .map((p) => ({ name: p.name, weight: Number(p.weight), rating: mine.get(p.name)?.rating_1_to_5 ?? null }));
  const known = new Set(defined.map((d) => d.name));
  const extra = [...mine.values()]
    .filter((r) => !known.has(r.kra_parameter))
    .map((r) => ({ name: r.kra_parameter, weight: Number(r.weight ?? 0), rating: r.rating_1_to_5 }));
  return [...defined, ...extra.filter((x) => x.weight > 0)].map((r) => ({
    ...r,
    rating: r.rating === null ? null : Number(r.rating),
  }));
}

/**
 * Scores everyone who has any data for the month and ranks them. Pure: all inputs are passed in,
 * so the same function serves the live recompute and the tests.
 */
export function planMonthScores(data: MonthData): {
  rows: ScoreRowOut[];
  cards: Map<string, ScoreCardModel>;
  summary: { scored: number; pending: number; companyAverage: number | null };
} {
  // Holidays are nobody's absence: they leave the denominator and anything punched on them is ignored.
  const off = holidayDates(data.holidays ?? [], data.attendance);
  const workingDays = workingDaysInMonth(data.monthKey, off);
  const label = monthLabel(data.monthKey);
  const results = [];

  for (const e of data.employees) {
    const attendance = data.attendance.filter((a) => a.employeeId === e.id && !off.has(a.workDate));
    // Probation: no paid leave. Sundays and official holidays are off for everyone.
    const probation = onProbation(e.join_date, data.monthKey);
    // Leave taken is not held against anyone (except on probation): those days leave this person's working days.
    const leaveDays = probation
      ? 0
      : new Set(
          attendance.filter((a) => a.status === "Leave" && new Date(`${a.workDate}T00:00:00Z`).getUTCDay() !== 0).map((a) => a.workDate),
        ).size;
    const personalWorkingDays = Math.max(0, workingDays - leaveDays);
    const ratings = ratingsFor(e, data.params, data.ratings);
    const audit = data.audit.get(e.id) ?? null;
    const hasRating = ratings.some((r) => r.rating !== null);
    // Someone with no attendance, no rating and no audit entry has nothing to show this month.
    if (!attendance.length && !hasRating && !audit) continue;

    const result = computeScore({ role: e.role_group, workingDays: personalWorkingDays, leaveDays, warningsUsedBefore: data.warningsUsed?.get(e.id) ?? 0, attendance, audit, ratings, rules: data.rules });
    const card = buildScoreCard({
      name: e.name,
      role: e.role,
      roleGroup: e.role_group,
      month: label,
      result,
      ratings,
      audit,
      ...(data.now ? { now: data.now } : {}),
    });
    results.push({ e, result, card, ratings, audit });
  }

  const ranked = rankMonth(results.map((r) => ({ id: r.e.id, group: r.e.role_group, final: r.result.final })));
  const cards = new Map<string, ScoreCardModel>();
  const rows: ScoreRowOut[] = results.map(({ e, result, card, ratings, audit }) => {
    cards.set(e.id, card);
    const rk = ranked.ranks.get(e.id)!;
    const claude = data.claudeScores?.get(e.id);
    return {
      month_key: data.monthKey,
      employee_id: e.id,
      final_score: result.final,
      rag: result.rag,
      rank_in_role: rk.rankInRole,
      overall_rank: rk.overallRank,
      is_top3: rk.isTop3,
      breakdown: result.components.map((c) => ({
        label: c.label,
        weight: c.weight,
        score: c.score ?? 0,
        contribution: c.score === null ? 0 : Math.round(((c.score * c.weight) / 100) * 10) / 10,
        note: c.note,
      })),
      criteria: ratings.map((r) => ({ name: r.name, weight: r.weight, rating: r.rating ?? 0, rated: r.rating !== null })),
      note: audit?.flags.join(" · ") ?? "",
      details: {
        card,
        facts: result.facts,
        missing: result.missing,
        status: result.status,
        filing_discipline_pct:
          result.facts.visibilityFactor === null ? null : Math.round(result.facts.visibilityFactor * 1000) / 10,
        dpr_days: (audit?.dprDays ?? []).map((d) => ({
          date: d.date,
          grade: d.grade,
          summary: [d.project, d.note].filter(Boolean).join(": "),
          blockers: "",
          plan: "",
        })),
        claude_final_score: claude ?? null,
      },
      source: "computed" as const,
    };
  });

  return {
    rows,
    cards,
    summary: {
      scored: results.filter((r) => r.result.status === "scored").length,
      pending: results.filter((r) => r.result.status === "pending").length,
      companyAverage: ranked.companyAverage,
    },
  };
}
