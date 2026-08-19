export type Rag = "RED" | "YELLOW" | "GREEN";

export type RoleGroup = "supervisor" | "designer" | "ea";

export interface BreakdownSegment {
  label: string;
  weight: number;
  score: number;
  contribution: number;
}

export interface CriterionRating {
  name: string;
  weight: number;
  rating: number;
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
  score: number;
  rag: Rag;
  rankInRole: number | null;
  overallRank: number | null;
  isTop3: boolean;
  breakdown: BreakdownSegment[];
  criteria: CriterionRating[];
  note: string;
  presentDays: number;
  absentDays: number;
  avgHours: number;
  punctualityDeviation: number;
  days: AttendanceDay[];
  filingDiscipline: number | null;
  dprActivity: DprActivityEntry[];
  taskActivity: TaskActivityEntry[];
  reportCard?: ReportCardDetail;
}

export interface DashboardData {
  month: string;
  months: string[];
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
  | { viewerRole: "manager"; month: string; months: string[]; roster: RosterEntry[]; own: Employee | null }
  | { viewerRole: "employee"; month: string; employee: Employee | null };

export interface AccessUser {
  id: string;
  email: string;
  role: ViewerRole;
  employeeId: string | null;
  employeeName: string | null;
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

export function ragLabel(rag: Rag): string {
  return rag === "GREEN" ? "Strong" : rag === "YELLOW" ? "On Track" : "Needs Attention";
}

export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}