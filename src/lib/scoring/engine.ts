import { attendanceBlend, dprStats, managerStats, visibility } from "./attendance-score";
import { hhmm, TARGET_HOURS, WEIGHTS, ragFor } from "./constants";
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
  const blend = attendanceBlend(input.attendance, workingDays, rule);
  const vis = visibility(role, blend.attendedDates, input.audit);
  const dpr = input.audit && role === "supervisor" ? dprStats(input.audit, workingDays) : null;
  const mgr = managerStats(input.ratings);
  const coordination = role === "designer" ? (input.audit?.coordinationPct ?? null) : null;

  const adjusted = round1(blend.raw * (vis.factor ?? 1));

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
    `Present ${blend.attendedDays} of ${workingDays} working days` +
    (blend.creditDays < blend.attendedDays ? `, worth ${blend.creditDays} full-duty days because some days ended short` : "") +
    ` (${pct(blend.presence * 100)}), ` +
    `averaging ${blend.avgHours}h a day against ${TARGET_HOURS}h` +
    (blend.punctualitySample
      ? `, on time on ${blend.onTimeDays} of ${blend.punctualitySample} days (in by ${hhmm(rule.startMin + rule.graceMin)}, or a full ${TARGET_HOURS}h day)`
      : "") +
    ` -> raw ${blend.raw}%.` +
    (vis.factor !== null && vis.factor < 1
      ? ` A real update was visible on only ${vis.visibleDays} of ${vis.presentDays} days present -> adjusted down to ${adjusted}%.`
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
    creditDays: blend.creditDays,
    avgHours: blend.avgHours,
    presencePct: round1(blend.presence * 100),
    hoursPct: round1(blend.hours * 100),
    punctualityPct: round1(blend.punctuality * 100),
    onTimeDays: blend.onTimeDays,
    punctualitySample: blend.punctualitySample,
    shortDays: blend.shortDays,
    avgShortMin: blend.avgShortMin,
    halfDays: blend.halfDays,
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
