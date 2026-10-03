import { TARGET_HOURS } from "../attendance/metrics";
import type { DutyRule, Rag, RoleGroup } from "./types";

export { TARGET_HOURS };

/** Component weights in percent, exactly as the KRA sheet applied them. */
export const WEIGHTS = {
  supervisor: { attendance: 30, dpr: 50, feedback: 20 },
  designer: { attendance: 25, coordination: 40, feedback: 35 },
  /** A designer with no coordination tasks that month: attendance and feedback carry half each. */
  designerNoCoordination: { attendance: 50, feedback: 50 },
  ea: { attendance: 60, feedback: 40 },
} as const;

/** DPR Combined = coverage x 40% + quality x 60%. */
export const DPR_BLEND = { coverage: 0.4, quality: 0.6 } as const;

/** A month with fewer visible updates than days present costs a warning instead of attendance points, this many times a year. */
export const WARNINGS_PER_YEAR = 2;

export const GRADE_SCORE: Record<string, number> = { excellent: 100, good: 75, partial: 50, poor: 25 };

/** Design work spans days, so a designer's visibility penalty never goes below this. */
export const DESIGNER_VISIBILITY_FLOOR = 0.5;

/**
 * Duty rules agreed for everyone: a 30-minute grace period, and a full day is 8 hours 30 minutes.
 * Attendance is hours worked against working days x 8h30, so arriving late is fine if the hours are made up. Designers and the EA start at 10:00, supervisors at 11:00.
 * The values in the duty_rules table override these.
 */
export const DEFAULT_DUTY_RULES: Record<RoleGroup, DutyRule> = {
  supervisor: { startMin: 11 * 60, graceMin: 30, requiredMin: 510 },
  designer: { startMin: 10 * 60, graceMin: 30, requiredMin: 510 },
  ea: { startMin: 10 * 60, graceMin: 30, requiredMin: 510 },
};

export const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

export const RAG_RED_BELOW = 60;
export const RAG_GREEN_FROM = 75;

export function ragFor(score: number): Rag {
  return score >= RAG_GREEN_FROM ? "GREEN" : score >= RAG_RED_BELOW ? "YELLOW" : "RED";
}

export function bandText(rag: Rag | null): string {
  if (rag === "GREEN") return "GREEN -- 75% and above. Strong month.";
  if (rag === "YELLOW") return "YELLOW -- 60-75%. Solid in places, real gaps in others.";
  if (rag === "RED") return "RED -- below 60%. This needs direct, prompt attention.";
  return "Not scored yet -- waiting for the inputs listed below.";
}

export const ROLE_LABEL: Record<RoleGroup, string> = {
  supervisor: "Site Supervisor",
  designer: "Interior Designer",
  ea: "Executive Assistant",
};
