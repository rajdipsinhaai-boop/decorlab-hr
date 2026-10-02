export type RoleGroup = "supervisor" | "designer" | "ea";
export type Rag = "RED" | "YELLOW" | "GREEN";

/** One person-day, as the engine needs it. */
export interface AttDay {
  workDate: string; // YYYY-MM-DD
  status: string;
  inAt: string | null;
  workMin: number | null;
  shift?: string | null;
}

/** A role's duty day: when it starts, how long you may be late, and the hours that make up a full day. */
export interface DutyRule {
  startMin: number; // minutes after midnight
  graceMin: number;
  requiredMin: number; // minutes of duty that make up a full day
}

/** What the monthly Claude audit knows about one person. */
export interface AuditPerson {
  dprDays: { date: string; grade: string; score: number | null; blank: boolean; project: string; note: string }[];
  /** Used only when the audit sent summary numbers without the per-day list. */
  dprFilingDays: number | null;
  coveragePct: number | null;
  dprQuality: number | null;
  /** 0-100, or null when the designer had no coordination tasks that month. */
  coordinationPct: number | null;
  coordinationBasis: string;
  /** Days with any visible work in Rdash (designers / EA). null = the audit did not say. */
  activityDays: string[] | null;
  vendorOrders: number | null;
  flags: string[];
  comments: { why: string[]; improve: string[] };
}

export interface RatingIn {
  name: string;
  weight: number; // fraction, e.g. 0.2
  rating: number | null; // 1-5, or null = not rated yet
}

export interface ScoreInput {
  role: RoleGroup;
  workingDays: number;
  attendance: AttDay[];
  audit: AuditPerson | null;
  ratings: RatingIn[];
  rules: Record<RoleGroup, DutyRule>;
}

export interface Component {
  key: "attendance" | "dpr" | "coordination" | "feedback";
  label: string;
  weight: number; // percent
  score: number | null; // 0-100, null while an input is missing
  note: string;
}

export interface Facts {
  workingDays: number;
  attendedDays: number;
  avgHours: number;
  presencePct: number;
  hoursPct: number;
  punctualityPct: number;
  onTimeDays: number;
  punctualitySample: number;
  rawAttendance: number;
  visibilityFactor: number | null;
  visibleDays: number;
  adjustedAttendance: number;
  dpr: { filingDays: number; blankDays: number; coveragePct: number; qualityPct: number; combined: number } | null;
  coordinationPct: number | null;
  feedback: { percent: number; average: number; rated: number; total: number };
}

export interface ScoreResult {
  status: "scored" | "pending";
  /** What is still missing when pending, in plain words. */
  missing: string[];
  final: number | null;
  rag: Rag | null;
  components: Component[];
  facts: Facts;
}

/** Everything the report card and the dashboard need to show one person's month. */
export interface ScoreCardModel {
  version: 1;
  name: string;
  role: string;
  roleGroup: RoleGroup;
  month: string; // "September 2026"
  finalScore: number | null;
  rag: Rag | null;
  pending: string[];
  bandText: string;
  components: { label: string; weight: number; score: number | null; note: string }[];
  kra: { name: string; rating: number | null }[];
  why: string[];
  improve: string[];
  generatedAt: string;
}
