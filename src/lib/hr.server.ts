import { batchGet, SCHEDULED_START_MINUTES } from "./sheets.server";
import { fallbackBatchGet } from "./fallback.server";
import reportCards from "@/data/report-cards.json";
import {
  ragOf,
  type AttendanceDay,
  type BreakdownSegment,
  type ControlRow,
  type CriterionRating,
  type DashboardData,
  type DprActivityEntry,
  type Employee,
  type Rag,
  type RoleGroup,
  type TaskActivityEntry,
} from "./hr-types";

const TARGET_HOURS = 9;

type ReportCardSnapshot = {
  month: string;
  scoreBuilt: string[];
  whyScore: string[];
  improveNextMonth: string[];
  pdfFilename: string;
  pdfBase64: string;
};

const REPORT_CARDS = reportCards as Record<string, ReportCardSnapshot>;

type Grid = string[][];

const cell = (row: string[] | undefined, i: number) => (row?.[i] ?? "").toString().trim();
const num = (v: string) => {
  const n = parseFloat(v.replace(/[%,]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

function headerIndex(headers: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  headers.forEach((h, i) => {
    const key = h.replace(/\s+/g, " ").trim().toLowerCase();
    if (key && !(key in map)) map[key] = i;
  });
  return map;
}

function find(map: Record<string, number>, ...needles: string[]): number {
  for (const needle of needles) {
    const n = needle.toLowerCase();
    const exact = map[n];
    if (exact !== undefined) return exact;
    const partial = Object.keys(map).find((k) => k.includes(n));
    if (partial) return map[partial]!;
  }
  return -1;
}

function timeToMinutes(t: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(t.trim());
  if (!m) return null;
  return parseInt(m[1]!, 10) * 60 + parseInt(m[2]!, 10);
}

function hoursToNumber(t: string): number {
  const m = /^(\d{1,2}):(\d{2})/.exec(t.trim());
  if (m) return parseInt(m[1]!, 10) + parseInt(m[2]!, 10) / 60;
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : 0;
}

function roleGroupOf(role: string): RoleGroup {
  const r = role.toLowerCase();
  if (r.includes("supervisor")) return "supervisor";
  if (r.includes("designer")) return "designer";
  return "ea";
}

/** KRA tabs: header on row 3, per-parameter rows, then a "<Name> — TOTAL" row. */
interface KraRecord {
  criteria: CriterionRating[];
  totals: Record<string, string>;
  note: string;
}

function parseKraTab(grid: Grid): Record<string, KraRecord> {
  const headers = grid[0] ?? [];
  const map = headerIndex(headers);
  const iName = find(map, "employee name");
  const iParam = find(map, "kra parameter");
  const iWeight = find(map, "weight %");
  const iRating = find(map, "rating (1-5)", "rating");
  const out: Record<string, KraRecord> = {};

  for (const row of grid.slice(1)) {
    const rawName = cell(row, iName);
    if (!rawName) continue;
    const isTotal = /—\s*TOTAL/i.test(rawName) || /-\s*TOTAL/i.test(rawName);
    const name = rawName.replace(/[—-]\s*TOTAL.*$/i, "").trim();
    const rec = (out[name] ??= { criteria: [], totals: {}, note: "" });
    if (isTotal) {
      headers.forEach((h, i) => {
        const key = h.replace(/\s+/g, " ").trim().toLowerCase();
        if (key) rec.totals[key] = cell(row, i);
      });
      rec.note = rec.totals["coordination basis"] ?? "";
    } else {
      const param = cell(row, iParam);
      if (param && param.toLowerCase() !== "overall score") {
        rec.criteria.push({
          name: param,
          weight: num(cell(row, iWeight)),
          rating: num(cell(row, iRating)),
        });
      }
    }
  }
  return out;
}

function totalNum(rec: KraRecord | undefined, ...needles: string[]): number {
  if (!rec) return 0;
  for (const needle of needles) {
    const n = needle.toLowerCase();
    const key = Object.keys(rec.totals).find((k) => k.includes(n));
    if (key) return num(rec.totals[key]!);
  }
  return 0;
}

function buildBreakdown(group: RoleGroup, rec: KraRecord | undefined): BreakdownSegment[] {
  const managerRating = totalNum(rec, "manager rating");
  const seg = (label: string, weight: number, score: number): BreakdownSegment => ({
    label,
    weight,
    score: Math.round(score * 10) / 10,
    contribution: Math.round(((score * weight) / 100) * 10) / 10,
  });

  if (group === "supervisor") {
    return [
      seg("Attendance (discipline-adjusted)", 30, totalNum(rec, "attendance score (discipline", "attendance score")),
      seg("DPR Combined", 50, totalNum(rec, "dpr combined")),
      seg("System Work Feedback", 20, managerRating),
    ];
  }
  if (group === "designer") {
    return [
      seg("Attendance", 25, totalNum(rec, "attendance score", "attendance")),
      seg("Coordination", 40, totalNum(rec, "coordination score", "coordination")),
      seg("System Work Feedback", 35, managerRating),
    ];
  }
  return [
    seg("Attendance", 60, totalNum(rec, "attendance score", "attendance")),
    seg("System Work Feedback", 40, managerRating),
  ];
}

function reportCardNarrative(
  snapshot: ReportCardSnapshot | undefined,
  breakdown: BreakdownSegment[],
  score: number,
  rag: Rag,
  month: string,
  presentDays: number,
  absentDays: number,
): { scoreBuilt: string[]; whyScore: string[]; improveNextMonth: string[] } | null {
  if (!snapshot) return null;
  const scoreBuilt = snapshot.scoreBuilt.length
    ? snapshot.scoreBuilt
    : [
        ...breakdown.map((segment) => `${segment.label} (weight ${segment.weight}%) ${segment.score}% → ${segment.contribution} pts.`),
        `Final score: ${score}% (${rag}) for ${month}.`,
      ];
  const whyScore = snapshot.whyScore.length
    ? snapshot.whyScore
    : [
        `This score is calculated from the weighted sections shown above.`,
        `Attendance record: ${presentDays} present day(s) and ${absentDays} absent day(s).`,
      ];
  const improveNextMonth = snapshot.improveNextMonth.length
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

function reviewMonth(grid: Grid): string {
  // Row 2 of each tab: ["Review Month:", "July 2026", ...]
  const row = grid[0] ?? [];
  return cell(row, 1) || "";
}

interface ActivityBundle {
  dpr: Record<string, DprActivityEntry[]>;
  task: Record<string, TaskActivityEntry[]>;
  filing: Record<string, number>;
}

/** Activity Log tabs are optional — a missing tab must not break the dashboard. */
async function loadActivityLogs(month: string): Promise<ActivityBundle> {
  const out: ActivityBundle = { dpr: {}, task: {}, filing: {} };
  const dprRange = "DPR Activity Log!A1:H3000";
  const taskRange = "Task Activity Log!A1:H3000";

  const read = async (range: string): Promise<Grid> => {
    try {
      return (await batchGet([range]))[range] ?? [];
    } catch {
      return [];
    }
  };

  const [dprGrid, taskGrid] = await Promise.all([read(dprRange), read(taskRange)]);

  const inMonth = (row: string[], monthCol: number) => {
    const m = cell(row, monthCol);
    return !month || !m || m.toLowerCase() === month.toLowerCase();
  };

  if (dprGrid.length > 1) {
    const map = headerIndex(dprGrid[0] ?? []);
    const i = {
      name: find(map, "employee name"),
      date: find(map, "date"),
      grade: find(map, "grade"),
      summary: find(map, "work summary"),
      blockers: find(map, "blockers"),
      plan: find(map, "tomorrow"),
      month: find(map, "month"),
    };
    for (const row of dprGrid.slice(1)) {
      const name = cell(row, i.name);
      if (!name || !inMonth(row, i.month)) continue;
      const summary = cell(row, i.summary);
      const isSummary = /^summary$/i.test(cell(row, i.date)) || /^summary/i.test(cell(row, i.grade));
      if (isSummary) {
        const pct = /(\d+(\.\d+)?)\s*%?/.exec(`${summary} ${cell(row, i.blockers)}`.trim());
        if (pct) out.filing[name] = Math.round(parseFloat(pct[1]!));
        continue;
      }
      (out.dpr[name] ??= []).push({
        date: cell(row, i.date),
        grade: cell(row, i.grade),
        summary,
        blockers: cell(row, i.blockers),
        plan: cell(row, i.plan),
      });
    }
  }

  if (taskGrid.length > 1) {
    const map = headerIndex(taskGrid[0] ?? []);
    const i = {
      name: find(map, "employee name"),
      task: find(map, "task name"),
      status: find(map, "status"),
      assigned: find(map, "assigned date"),
      done: find(map, "done date"),
      revisions: find(map, "revision"),
      notes: find(map, "notes"),
      month: find(map, "month"),
    };
    for (const row of taskGrid.slice(1)) {
      const name = cell(row, i.name);
      if (!name || !inMonth(row, i.month)) continue;
      (out.task[name] ??= []).push({
        task: cell(row, i.task),
        status: cell(row, i.status),
        assignedDate: cell(row, i.assigned),
        doneDate: cell(row, i.done),
        revisions: cell(row, i.revisions),
        notes: cell(row, i.notes),
      });
    }
  }

  return out;
}

export async function loadDashboard(): Promise<DashboardData> {
  const ranges = [
    "Monthly Summary!A2:B2",
    "Employee Master!A3:I200",
    "Monthly Summary!A3:H200",
    "Supervisor KRA!A3:Q400",
    "Designer KRA!A3:Q400",
    "EA KRA!A3:Q200",
    "Daily Attendance!A3:I5000",
  ];
  let data: Record<string, string[][]>;
  try {
    data = await batchGet(ranges);
  } catch (error) {
    console.warn("Google Sheets unavailable; using the attached workbook fallback.", error);
    data = fallbackBatchGet(ranges);
  }

  const month = reviewMonth(data[ranges[0]!] ?? []) || "Current period";
  const master = data[ranges[1]!] ?? [];
  const summary = data[ranges[2]!] ?? [];
  const supervisor = parseKraTab(data[ranges[3]!] ?? []);
  const designer = parseKraTab(data[ranges[4]!] ?? []);
  const ea = parseKraTab(data[ranges[5]!] ?? []);
  const attendance = data[ranges[6]!] ?? [];
  const activity = await loadActivityLogs(month);

  // Employee master
  const mHeaders = master[0] ?? [];
  const mMap = headerIndex(mHeaders);
  const mi = {
    id: find(mMap, "employee id"),
    name: find(mMap, "employee name"),
    role: find(mMap, "role"),
    dept: find(mMap, "department"),
    manager: find(mMap, "reporting manager"),
    join: find(mMap, "date of joining"),
    status: find(mMap, "status"),
  };

  // Monthly summary
  const sHeaders = summary[0] ?? [];
  const sMap = headerIndex(sHeaders);
  const si = {
    name: find(sMap, "employee name"),
    score: find(sMap, "final kra score"),
    rag: find(sMap, "rag flag"),
    rankRole: find(sMap, "rank (in role)", "rank in role"),
    rankOverall: find(sMap, "overall rank"),
    top3: find(sMap, "top 3"),
  };
  const summaryByName: Record<string, string[]> = {};
  for (const row of summary.slice(1)) {
    const name = cell(row, si.name);
    if (name && !/company|overview/i.test(name)) summaryByName[name] = row;
  }

  // Daily attendance grouped by employee name
  const aHeaders = attendance[0] ?? [];
  const aMap = headerIndex(aHeaders);
  const ai = {
    date: find(aMap, "date"),
    day: find(aMap, "day"),
    name: find(aMap, "employee name"),
    status: find(aMap, "status"),
    inT: find(aMap, "in time"),
    outT: find(aMap, "out time"),
    hours: find(aMap, "hours worked"),
  };
  const daysByName: Record<string, AttendanceDay[]> = {};
  for (const row of attendance.slice(1)) {
    const name = cell(row, ai.name);
    if (!name) continue;
    (daysByName[name] ??= []).push({
      date: cell(row, ai.date),
      day: cell(row, ai.day),
      status: cell(row, ai.status) || "Unknown",
      inTime: cell(row, ai.inT),
      outTime: cell(row, ai.outT),
      hours: hoursToNumber(cell(row, ai.hours)),
    });
  }

  const employees: Employee[] = [];
  for (const row of master.slice(1)) {
    const name = cell(row, mi.name);
    if (!name) continue;
    if (mi.status >= 0 && cell(row, mi.status).toLowerCase() === "inactive") continue;
    const role = cell(row, mi.role);
    const group = roleGroupOf(role);
    const rec = group === "supervisor" ? supervisor[name] : group === "designer" ? designer[name] : ea[name];
    const sRow = summaryByName[name];

    const score = sRow ? num(cell(sRow, si.score)) : totalNum(rec, "final kra");
    const ragRaw = (sRow ? cell(sRow, si.rag) : rec?.totals["rag flag"]) ?? "";
    const rag: Rag = ["RED", "YELLOW", "GREEN"].includes(ragRaw.toUpperCase())
      ? (ragRaw.toUpperCase() as Rag)
      : ragOf(score);

    const days = daysByName[name] ?? [];
    const present = days.filter((d) => /present|incomplete/i.test(d.status));
    const deviations = present
      .map((d) => timeToMinutes(d.inTime))
      .filter((m): m is number => m !== null)
      .map((m) => m - SCHEDULED_START_MINUTES);
    const hoursList = present.map((d) => d.hours).filter((h) => h > 0);

    const reportCard = REPORT_CARDS[name.toLowerCase()];
    const reportNarrative = reportCardNarrative(reportCard, buildBreakdown(group, rec), Math.round(score * 10) / 10, rag, month, present.length, days.filter((d) => /absent/i.test(d.status)).length);

    employees.push({
      id: cell(row, mi.id) || name,
      name,
      role,
      roleGroup: group,
      department: cell(row, mi.dept),
      manager: cell(row, mi.manager),
      joinDate: cell(row, mi.join),
      score: Math.round(score * 10) / 10,
      rag,
      rankInRole: sRow && cell(sRow, si.rankRole) ? num(cell(sRow, si.rankRole)) : null,
      overallRank: sRow && cell(sRow, si.rankOverall) ? num(cell(sRow, si.rankOverall)) : null,
      isTop3: Boolean(sRow && si.top3 >= 0 && cell(sRow, si.top3)),
      breakdown: buildBreakdown(group, rec),
      criteria: rec?.criteria ?? [],
      note: rec?.note ?? "",
      presentDays: present.length,
      absentDays: days.filter((d) => /absent/i.test(d.status)).length,
      avgHours: hoursList.length ? Math.round((hoursList.reduce((a, b) => a + b, 0) / hoursList.length) * 10) / 10 : 0,
      punctualityDeviation: deviations.length
        ? Math.round(deviations.reduce((a, b) => a + b, 0) / deviations.length)
        : 0,
      days,
      filingDiscipline: activity.filing[name] ?? null,
      dprActivity: activity.dpr[name] ?? [],
      taskActivity: activity.task[name] ?? [],
      reportCard: reportCard && reportNarrative
        ? {
            month: reportCard.month,
            ...reportNarrative,
            downloadPath: `/api/report-card?name=${encodeURIComponent(name)}`,
          }
        : undefined,
    });
  }

  return {
    month,
    months: month ? [month] : [],
    targetHours: TARGET_HOURS,
    scheduledStart: `${String(Math.floor(SCHEDULED_START_MINUTES / 60)).padStart(2, "0")}:${String(
      SCHEDULED_START_MINUTES % 60,
    ).padStart(2, "0")}`,
    employees,
  };
}

export async function loadControlRows(): Promise<ControlRow[]> {
  const range = "Control!A3:H500";
  let grid: string[][];
  try {
    grid = (await batchGet([range]))[range] ?? [];
  } catch (error) {
    console.warn("Google Sheets unavailable; using the attached workbook Control fallback.", error);
    grid = fallbackBatchGet([range])[range] ?? [];
  }
  return grid.slice(1).flatMap((row) => {
    const requestId = cell(row, 0);
    if (!requestId) return [];
    const rawType = cell(row, 7);
    const type =
      rawType.toLowerCase().includes("attendance")
        ? "Attendance Upload"
        : rawType.toLowerCase().includes("whatsapp")
          ? "WhatsApp Export"
          : "Create Report";
    return [
      {
        requestId,
        requestedAt: cell(row, 1),
        requestedBy: cell(row, 2),
        month: cell(row, 3),
        status: cell(row, 4).toUpperCase(),
        driveLink: cell(row, 5),
        completedAt: cell(row, 6),
        type: type as ControlRow["type"],
      },
    ];
  });
}