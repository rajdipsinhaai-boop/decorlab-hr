import type { ScoreCardModel } from "./scoring/types";

export type { ScoreCardModel };

export type Rag = "RED" | "YELLOW" | "GREEN";

export type RoleGroup = "supervisor" | "designer" | "ea";

export interface BreakdownSegment {
  label: string;
  weight: number;
  score: number;
  contribution: number;
  /** One-line explanation of how this part was reached (computed months). */
  note?: string;
}

export interface CriterionRating {
  name: string;
  weight: number;
  rating: number;
  /** false = not rated yet (the rating above is then a placeholder 0). */
  rated?: boolean;
}

export interface AttendanceDay {
  date: string;
  day: string;
  status: string;
  inTime: string;
  outTime: string;
  hours: number;
}

export interface DprActivityEntry {
  date: string;
  grade: string;
  summary: string;
  blockers: string;
  plan: string;
}

export interface TaskActivityEntry {
  task: string;
  status: string;
  assignedDate: string;
  doneDate: string;
  revisions: string;
  notes: string;
}

export interface ReportCardDetail {
  month: string;
  scoreBuilt: string[];
  whyScore: string[];
  improveNextMonth: string[];
  downloadPath: string;
}

export interface Employee {
  id: string;
  name: string;
  role: string;
  roleGroup: RoleGroup;
  department: string;
  manager: string;
  joinDate: string;
  /** null until the month has been scored (attendance can be on file before scoring happens). */
  score: number | null;
  rag: Rag | null;
  rankInRole: number | null;
  overallRank: number | null;
  isTop3: boolean;
  breakdown: BreakdownSegment[];
  criteria: CriterionRating[];
  note: string;
  presentDays: number;
  /** Hours worked on the days attended. */
  totalHours: number;
  absentDays: number;
  leaveDays: number;
  /** False when no attendance report has been uploaded for this month yet. */
  hasAttendance: boolean;
  avgHours: number;
  punctualityDeviation: number;
  days: AttendanceDay[];
  filingDiscipline: number | null;
  /** Everything needed to explain this month's score; present for computed months. */
  card?: ScoreCardModel;
  /** Where the score came from: the old spreadsheet or the backend's own calculation. */
  scoreSource?: string;
  dprActivity: DprActivityEntry[];
  taskActivity: TaskActivityEntry[];
  reportCard?: ReportCardDetail;
}

export interface MonthInfo {
  month: string;
  hasAttendance: boolean;
  hasScores: boolean;
}

export interface TrendPoint {
  month: string;
  /** Average final score of everyone scored that month; null when nobody was. */
  average: number | null;
  scored: number;
}

export interface DashboardData {
  month: string;
  /** Set once an administrator has finalized the month: its scores are frozen. */
  locked: { at: string; by: string } | null;
  /** Every month from the first one on record to the current month, newest first. */
  months: string[];
  monthInfo: MonthInfo[];
  trend: TrendPoint[];
  targetHours: number;
  scheduledStart: string;
  employees: Employee[];
}

export type ViewerRole = "admin" | "manager" | "employee";

export interface RosterEntry {
  id: string;
  name: string;
  role: string;
  roleGroup: RoleGroup;
}

export type DashboardView =
  | { viewerRole: "admin"; data: DashboardData }
  | {
      viewerRole: "manager";
      month: string;
      months: string[];
      roster: RosterEntry[];
      own: Employee | null;
    }
  | { viewerRole: "employee"; month: string; employee: Employee | null };

export interface AccessUser {
  id: string;
  email: string;
  role: ViewerRole;
  employeeId: string | null;
  employeeName: string | null;
  position: string | null;
  createdAt: string;
}

export interface ControlRow {
  requestId: string;
  requestedAt: string;
  requestedBy: string;
  month: string;
  status: string;
  driveLink: string;
  completedAt: string;
  type: RequestType;
}

export type RequestType = "Create Report" | "Attendance Upload" | "WhatsApp Export";

export type WhatsAppGroup = "Decorlab Designers Group" | "Decorlab Supervisors Group";

export function ragOf(score: number): Rag {
  if (score >= 75) return "GREEN";
  if (score >= 60) return "YELLOW";
  return "RED";
}

export function ragLabel(rag: Rag | null): string {
  return rag === null
    ? "Not scored yet"
    : rag === "GREEN"
      ? "Strong"
      : rag === "YELLOW"
        ? "On Track"
        : "Needs Attention";
}

export type { ImportStats, PersonOutcome } from "./attendance/plan";

export interface AttendanceUploadResult {
  jobId: string;
  uploadId: string;
  status: "queued" | "running" | "done" | "failed";
  stats?: import("./attendance/plan").ImportStats;
  error?: string;
}

export interface AttendanceUploadRow {
  id: string;
  filename: string;
  format: string | null;
  status: string;
  monthKeys: string[];
  periodStart: string | null;
  periodEnd: string | null;
  uploadedBy: string;
  createdAt: string;
  error: string | null;
  stats: import("./attendance/plan").ImportStats | null;
}

export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}
