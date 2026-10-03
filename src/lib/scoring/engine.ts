import { attendanceHours, dprStats, managerStats, visibility } from "./attendance-score";
import { TARGET_HOURS, WARNINGS_PER_YEAR, WEIGHTS, ragFor } from "./constants";
import type { Component, Facts, Rag, RoleGroup, ScoreInput, ScoreResult } from "./types";

const round1 = (n: number) => Math.round(n * 10) / 10;
const pct = (n: number) => `${round1(n)}%`;

/**
 * The sheet's final-score formulas, given the already-computed parts (all 0-100).
 * Kept separate so the old months can be re-checked against it.
 *   supervisor: attendance x 30% + DPR x 50% + feedback x 20%
 *   designer:   attendance x 25% + coordination x 40% + feedback x 35%
 *               (no coordination data: attendance x 50% + feedback x 50%)
 *   EA:         attendance x 60% + feedback x 40%
 */
export function combine(
  role: RoleGroup,
  p: { attendance: number; dpr?: number | null; coordination?: number | null; feedback: number },
): number {
  if (role === "supervisor") {
    const w = WEIGHTS.supervisor;
    return round1((p.attendance * w.attendance + (p.dpr ?? 0) * w.dpr + p.feedback * w.feedback) / 100);
  }
  if (role === "designer") {
    if (p.coordination === null || p.coordination === undefined) {
      const w = WEIGHTS.designerNoCoordination;
      return round1((p.attendance * w.attendance + p.feedback * w.feedback) / 100);
    }
    const w = WEIGHTS.designer;
    return round1((p.attendance * w.attendance + p.coordination * w.coordination + p.feedback * w.feedback) / 100);
  }
  const w = WEIGHTS.ea;
  return round1((p.attendance * w.attendance + p.feedback * w.feedback) / 100);
}

/** Turns one person's month of data into a score, or says exactly what is still missing. */
export function computeScore(input: ScoreInput): ScoreResult {
  const { role, workingDays } = input;
  const rule = input.rules[role];
  const blend = attendanceHours(input.attendance, workingDays, rule);
  const vis = visibility(role, blend.attendedDates, input.audit);
  const dpr = input.audit && role === "supervisor" ? dprStats(input.audit, workingDays) : null;
  const mgr = managerStats(input.ratings);
  const coordination = role === "designer" ? (input.audit?.coordinationPct ?? null) : null;

  // Fewer visible updates than days present: the first WARNINGS_PER_YEAR times a year this costs a
  // warning and leaves attendance alone; after that the visibility penalty applies.
  const missedUpdates = vis.factor !== null && vis.factor < 1;
  const usedBefore = input.warningsUsedBefore ?? 0;
  const warningUsed = missedUpdates && usedBefore < WARNINGS_PER_YEAR;
  const warningsLeft = Math.max(0, WARNINGS_PER_YEAR - usedBefore - (warningUsed ? 1 : 0));
  const adjusted = round1(blend.raw * (warningUsed ? 1 : (vis.factor ?? 1)));

  const missing: string[] = [];
  if (!input.attendance.length) missing.push("the attendance upload");
  if (role === "supervisor" && !dpr) missing.push("the Claude DPR audit");
  if (role === "designer" && !input.audit) missing.push("the Claude audit (coordination)");
  if (!input.ratings.length || mgr.rated < mgr.total) {
    missing.push(
      input.ratings.length
        ? `director ratings (${mgr.rated} of ${mgr.total} KRA parameters rated)`
        : "director ratings",
    );
  }

  const attNote =
    `Worked ${blend.workedHours}h${blend.overtimeHours ? ` (including ${blend.overtimeHours}h overtime)` : ""} of ${blend.expectedHours}h expected (${workingDays} working days x ${TARGET_HOURS}h${input.leaveDays ? `, after ${input.leaveDays} leave day${input.leaveDays > 1 ? "s" : ""} not held against you` : ""}) -> raw ${blend.raw}%. ` +
    `Present ${blend.attendedDays} days, averaging ${blend.avgHours}h a day.` +
    (warningUsed
      ? ` A real update was visible on only ${vis.visibleDays} of ${vis.presentDays} days present: one of your ${WARNINGS_PER_YEAR} yearly warnings was used, so attendance is not reduced (${warningsLeft} warning${warningsLeft === 1 ? "" : "s"} left this year).`
      : vis.factor !== null && vis.factor < 1
      ? ` A real update was visible on only ${vis.visibleDays} of ${vis.presentDays} days present, and both yearly warnings are already used -> adjusted down to ${adjusted}%.`
      : vis.factor !== null
        ? ` A real update was visible on every day present.`
        : "");

  const feedbackNote = mgr.total
    ? `${round1(mgr.percent)}% (${mgr.average}/5 weighted average) across ${mgr.total} KRA parameters` +
      (mgr.unrated.length ? `; ${mgr.unrated.length} not rated yet.` : ".")
    : "Not rated yet.";

  const components: Component[] = [];
  const w = role === "supervisor" ? WEIGHTS.supervisor : role === "designer" ? WEIGHTS.designer : WEIGHTS.ea;
  const noCoordination = role === "designer" && input.audit !== null && coordination === null;
  const attWeight = noCoordination ? WEIGHTS.designerNoCoordination.attendance : w.attendance;
  const fbWeight = noCoordination ? WEIGHTS.designerNoCoordination.feedback : w.feedback;

  components.push({
    key: "attendance",
    label: role === "supervisor" ? "Attendance (Visibility-Adjusted)" : "Attendance",
    weight: attWeight,
    score: input.attendance.length ? adjusted : null,
    note: input.attendance.length ? attNote : "No attendance uploaded for this month yet.",
  });
  if (role === "supervisor") {
    components.push({
      key: "dpr",
      label: "DPR Combined Score",
      weight: WEIGHTS.supervisor.dpr,
      score: dpr ? dpr.combined : null,
      note: dpr
        ? `Coverage ${dpr.coveragePct}% x 40%, plus DPR Quality ${dpr.qualityPct}/100 x 60%` +
          (dpr.blankDays ? ` -- ${dpr.blankDays} of ${dpr.filingDays} filed reports were essentially blank templates.` : ".")
        : "Waiting for the Claude DPR audit.",
    });
  }
  if (role === "designer" && !noCoordination) {
    components.push({
      key: "coordination",
      label: "Coordination",
      weight: WEIGHTS.designer.coordination,
      score: coordination,
      note: input.audit
        ? input.audit.coordinationBasis || "Share of revision/markup requests closed this month."
        : "Waiting for the Claude audit.",
    });
  }
  components.push({
    key: "feedback",
    label: "System Work Feedback",
    weight: fbWeight,
    score: input.ratings.length && mgr.rated === mgr.total ? mgr.percent : null,
    note: input.ratings.length ? feedbackNote : "Director ratings have not been entered yet.",
  });
  if (noCoordination) {
    // keep the explanation visible: nothing to close, so nothing is held against the designer
    const att = components[0]!;
    att.note += " No coordination tasks this month, so attendance and feedback carry half each.";
  }

  const facts: Facts = {
    workingDays,
    attendedDays: blend.attendedDays,
    avgHours: blend.avgHours,
    workedHours: blend.workedHours,
    expectedHours: blend.expectedHours,
    hoursPct: blend.raw,
    shortDays: blend.shortDays,
    avgShortMin: blend.avgShortMin,
    overtimeHours: blend.overtimeHours,
    leaveDays: input.leaveDays ?? 0,
    warningUsed,
    warningsLeft,
    requiredMin: rule.requiredMin,
    rawAttendance: blend.raw,
    visibilityFactor: vis.factor,
    visibleDays: vis.visibleDays,
    adjustedAttendance: adjusted,
    dpr,
    coordinationPct: coordination,
    feedback: { percent: mgr.percent, average: mgr.average, rated: mgr.rated, total: mgr.total },
  };

  if (missing.length) {
    return { status: "pending", missing, final: null, rag: null, components, facts };
  }
  const final = combine(role, {
    attendance: adjusted,
    dpr: dpr?.combined ?? null,
    coordination,
    feedback: mgr.percent,
  });
  return { status: "scored", missing: [], final, rag: ragFor(final), components, facts };
}

export interface RankRow {
  id: string;
  group: RoleGroup;
  final: number | null;
}
export interface Ranked {
  rankInRole: number | null;
  overallRank: number | null;
  isTop3: boolean;
}

/** Competition ranking (1, 2, 2, 4), within the role and company-wide. Unscored people are not ranked. */
export function rankMonth(rows: RankRow[]): {
  ranks: Map<string, Ranked>;
  companyAverage: number | null;
  zones: Record<Rag, number>;
} {
  const scored = rows.filter((r): r is RankRow & { final: number } => r.final !== null);
  const rank = (list: number[], mine: number) => 1 + list.filter((s) => s > mine).length;
  const ranks = new Map<string, Ranked>();
  for (const r of rows) {
    if (r.final === null) {
      ranks.set(r.id, { rankInRole: null, overallRank: null, isTop3: false });
      continue;
    }
    const overall = rank(
      scored.map((s) => s.final),
      r.final,
    );
    ranks.set(r.id, {
      rankInRole: rank(
        scored.filter((s) => s.group === r.group).map((s) => s.final),
        r.final,
      ),
      overallRank: overall,
      isTop3: overall <= 3,
    });
  }
  const zones: Record<Rag, number> = { GREEN: 0, YELLOW: 0, RED: 0 };
  for (const s of scored) zones[ragFor(s.final)]++;
  return {
    ranks,
    companyAverage: scored.length ? round1(scored.reduce((a, s) => a + s.final, 0) / scored.length) : null,
    zones,
  };
}
