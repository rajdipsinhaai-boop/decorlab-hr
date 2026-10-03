import { managerStats } from "./attendance-score";
import { TARGET_HOURS, WARNINGS_PER_YEAR } from "./constants";
import type { AuditPerson, RatingIn, RoleGroup, ScoreResult } from "./types";

const round1 = (n: number) => Math.round(n * 10) / 10;
const list = (names: string[]) =>
  names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

function dedupe(lines: string[]): string[] {
  const seen = new Set<string>();
  return lines.filter((l) => {
    const k = l.trim().toLowerCase();
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * "Why this score" and "What to improve" from the numbers, in plain direct sentences.
 * DPR-specific observations written by the Claude audit are appended (it has read the reports).
 */
export function buildNarrative(
  role: RoleGroup,
  result: ScoreResult,
  ratings: RatingIn[],
  audit: AuditPerson | null,
): { why: string[]; improve: string[] } {
  const f = result.facts;
  const mgr = managerStats(ratings);
  const why: string[] = [];
  const improve: string[] = [];

  if (result.status === "pending") {
    why.push(`This score is not final yet: still waiting for ${list(result.missing)}.`);
    if (f.attendedDays) {
      why.push(
        `So far: present ${f.attendedDays} of ${f.workingDays} working days, averaging ${f.avgHours}h a day.`,
      );
    }
    return { why, improve: ["The full improvement notes appear once every input is in."] };
  }

  // The component that costs the most points, and the one that earns the most.
  const scored = result.components.filter((c) => c.score !== null);
  const drag = [...scored].sort((a, b) => b.weight * (100 - b.score!) - a.weight * (100 - a.score!))[0];
  const best = [...scored].sort((a, b) => b.score! - a.score!)[0];
  if (result.rag === "GREEN") {
    why.push(
      `Strong month at ${result.final}%.${best ? ` ${best.label} was the standout at ${round1(best.score!)}%.` : ""}`,
    );
  } else if (drag) {
    why.push(
      `The biggest drag this month is ${drag.label} (${round1(drag.score!)}%, weight ${drag.weight}%), which costs ${round1((drag.weight * (100 - drag.score!)) / 100)} points off the final score.`,
    );
  }

  // Attendance: hours worked against working days x 8h30
  const hoursLine = `${f.workedHours}h worked${f.overtimeHours ? ` (including ${f.overtimeHours}h overtime)` : ""} of ${f.expectedHours}h expected (${f.workingDays} working days x ${TARGET_HOURS}h), ${f.hoursPct}%`;
  why.push(f.hoursPct >= 90 ? `Attendance is solid: ${hoursLine}.` : `Attendance: ${hoursLine}, which holds the attendance score back.`);
  if (f.warningUsed) {
    why.unshift(
      `Warning used: a real update was visible on only ${f.visibleDays} of your ${f.attendedDays} days present, so one of your ${WARNINGS_PER_YEAR} yearly warnings has been used (${f.warningsLeft} left this year). Your attendance score is not reduced for it. Once the warnings are used up, days without an update will reduce attendance.`,
    );
  } else if (f.visibilityFactor !== null && f.visibilityFactor < 1) {
    why.push(
      `You were present on ${f.attendedDays} days but a real update was visible on only ${f.visibleDays} of them, so your attendance credit drops from ${f.rawAttendance}% to ${f.adjustedAttendance}%. A day with no visible update counts as work nobody can see.`,
    );
  }

  if (f.shortDays >= 3) {
    why.push(
      `You completed the full ${TARGET_HOURS}h duty on ${f.attendedDays - f.shortDays} of ${f.attendedDays} days present; ` +
        `${f.shortDays} days ended short by about ${f.avgShortMin} minutes on average.`
    );
  }

  // Role specific evidence
  if (role === "supervisor" && f.dpr) {
    why.push(
      `DPR filed on ${f.dpr.filingDays} of ${f.workingDays} working days (${f.dpr.coveragePct}% coverage) with an average quality of ${f.dpr.qualityPct}/100.` +
        (f.dpr.blankDays ? ` ${f.dpr.blankDays} of the filed reports were essentially blank templates.` : ""),
    );
  }
  if (role === "designer") {
    why.push(
      f.coordinationPct === null
        ? "No coordination tasks were logged this month, so nothing is held against you here and attendance and feedback carry half each."
        : `Coordination: ${audit?.coordinationBasis || `${f.coordinationPct}% of revision requests closed.`}`,
    );
  }

  // Manager feedback
  if (mgr.total) {
    const bits: string[] = [];
    if (mgr.zeros.length) bits.push(`${list(mgr.zeros)} ${mgr.zeros.length > 1 ? "were" : "was"} rated 0`);
    if (mgr.low.length) bits.push(`${list(mgr.low)} ${mgr.low.length > 1 ? "were" : "was"} rated low`);
    if (mgr.high.length) bits.push(`${list(mgr.high)} ${mgr.high.length > 1 ? "were" : "was"} rated well (4 or 5)`);
    why.push(
      `System Work Feedback is ${round1(mgr.percent)}% (${mgr.average}/5 average across ${mgr.total} parameters)${bits.length ? ": " + bits.join("; ") : ""}.`,
    );
  }

  // What to improve
  if (role === "supervisor" && f.dpr && (f.dpr.coveragePct < 80 || f.dpr.blankDays > 0)) {
    improve.push(
      "File a DPR every working day with real content -- what was done, where, blockers and tomorrow's plan. A blank template scores as Poor and does not count as a visible update.",
    );
  } else if (f.visibilityFactor !== null && f.visibilityFactor < 1 && !f.warningUsed) {
    improve.push(
      "Make sure every day you are at work leaves a visible update in the system; each day without one reduces your attendance credit.",
    );
  }
  if (role === "designer" && f.coordinationPct !== null && f.coordinationPct < 100) {
    improve.push(
      "Respond to and close revision/markup comments promptly, even if the fix takes longer -- acknowledging and starting beats leaving it untouched.",
    );
  }
  if (f.shortDays >= 3) {
    improve.push(
      `Complete the full ${TARGET_HOURS}h duty every day you attend. Arriving late is fine if you stay on to make up the hours: ` +
        `work out your leaving time from when you punch in (for example, in at 11:30 means out at 20:00). ` +
        `${f.shortDays} days this month ended short, by about ${f.avgShortMin} minutes on average, and that shortfall is exactly what lowers your attendance score.`,
    );
  }
  if (f.shortDays < 3 && f.hoursPct < 90) {
    improve.push(
      `Hours are the whole attendance score: ${f.workedHours}h worked against ${f.expectedHours}h expected. Come in on every working day and complete the full ${TARGET_HOURS}h; arriving late costs nothing if you stay on to make it up.`,
    );
  }
  const weak = [...mgr.zeros, ...mgr.low];
  if (weak.length) {
    improve.push(`Ask your manager directly what is behind the low rating on ${list(weak)} -- it is usually one specific, fixable gap.`);
  }
  if (mgr.unrated.length) {
    improve.push(`Ask your manager to rate ${list(mgr.unrated)} -- unrated parameters currently count as 0 in the feedback average.`);
  }
  if (mgr.high.length) {
    improve.push(`Keep doing what is working on ${list(mgr.high.slice(0, 3))} -- those are your strongest areas.`);
  }
  if (!improve.length) {
    improve.push("Maintain this standard and agree one stretch improvement with your manager for next month.");
  }

  // Room is reserved for what the Claude audit wrote about the DPR reports, so the rule-based
  // sentences can never push it out.
  return {
    why: dedupe([...why.slice(0, 5), ...(audit?.comments.why ?? []).slice(0, 2)]),
    improve: dedupe([...improve.slice(0, 4), ...(audit?.comments.improve ?? []).slice(0, 2)]),
  };
}
