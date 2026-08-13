import { batchGet, SCHEDULED_START_MINUTES } from "./sheets.server";
import {
  ragOf,
  type AttendanceDay,
  type BreakdownSegment,
  type ControlRow,
  type CriterionRating,
  type DashboardData,
  type Employee,
  type Rag,
  type RoleGroup,
} from "./hr-types";

const TARGET_HOURS = 9;

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

function reviewMonth(grid: Grid): string {
  // Row 2 of each tab: ["Review Month:", "July 2026", ...]
  const row = grid[0] ?? [];
  return cell(row, 1) || "";
}

export async function loadDashboard(): Promise<DashboardData> {
  const ranges = [
    "Monthly Summary!B2:B2",
    "Employee Master!A3:I200",
    "Monthly Summary!A3:H200",
    "Supervisor KRA!A3:Q400",
    "Designer KRA!A3:Q400",
    "EA KRA!A3:Q200",
    "Daily Attendance!A3:I5000",
  ];
  const data = await batchGet(ranges);

  const month = reviewMonth(data[ranges[0]!] ?? []) || "Current period";
  const master = data[ranges[1]!] ?? [];
  const summary = data[ranges[2]!] ?? [];
  const supervisor = parseKraTab(data[ranges[3]!] ?? []);
  const designer = parseKraTab(data[ranges[4]!] ?? []);
  const ea = parseKraTab(data[ranges[5]!] ?? []);
  const attendance = data[ranges[6]!] ?? [];

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
  const range = "Control!A3:G500";
  const grid = (await batchGet([range]))[range] ?? [];
  return grid.slice(1).flatMap((row) => {
    const requestId = cell(row, 0);
    if (!requestId) return [];
    return [
      {
        requestId,
        requestedAt: cell(row, 1),
        requestedBy: cell(row, 2),
        month: cell(row, 3),
        status: cell(row, 4).toUpperCase(),
        driveLink: cell(row, 5),
        completedAt: cell(row, 6),
      },
    ];
  });
}