import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import type { MatchContext } from "@/lib/attendance/match";
import { resolveIdentity } from "@/lib/attendance/match";
import { currentMonthKey, dayOutcome, deriveStatus, monthKeysBetween, monthKeyOf, monthLabel, normalizeName } from "@/lib/attendance/normalize";
import { parseAttendanceFile } from "@/lib/attendance/parse.server";
import { planImport } from "@/lib/attendance/plan";
import { holidayDates, workingDaysInMonth } from "@/lib/attendance/metrics";
import type { ParsedReport } from "@/lib/attendance/types";

// The roster exactly as the migration seeds it.
const EMPLOYEES = [
  ["DLB-SUP-01", "Gouranga Panrui", "D115"],
  ["DLB-SUP-02", "Susovan Haldar", "D114"],
  ["DLB-SUP-03", "Sibhu Das", "D103"],
  ["DLB-SUP-04", "Arunava Mallick", "D102"],
  ["DLB-SUP-05", "Ranjan Maity", "D100"],
  ["DLB-SUP-06", "Subhajit Bhawal", "D116"],
  ["DLB-SUP-07", "Sukhendu Das", "D108"],
  ["DLB-DSG-01", "Bhavana Agarwal", "D109"],
  ["DLB-DSG-02", "Asif Ali Khan", "D105"],
  ["DLB-DSG-03", "Shibnath Mondal", "D111"],
  ["DLB-DSG-04", "Deep Das", "D104"],
  ["DLB-EA-01", "Priyanka Dalapati", "D113"],
] as const;

const ctx = (over: Partial<MatchContext> = {}): MatchContext => ({
  employees: EMPLOYEES.map(([id, name, cosecId]) => ({ id, name, cosecId })),
  aliases: new Map([
    ["sushovan haldar", "DLB-SUP-02"],
    ["gouranga parui", "DLB-SUP-01"],
  ]),
  excluded: new Map([["D112", "Driver: excluded from the performance system"]]),
  ...over,
});

let report: ParsedReport;
beforeAll(async () => {
  report = await parseAttendanceFile(new Uint8Array(readFileSync(new URL("./fixtures/cosec-sept-2026.xlsx", import.meta.url))));
});

describe("status derivation", () => {
  it.each([
    ["PR", "PR", "Present"],
    ["PR", "AB", "Present"],
    ["AB", "PR", "Present"],
    ["AB", "AB", "Absent"],
    ["WO", "WO", "Week Off"],
    ["PH", "PH", "Holiday"],
    ["PL", "PL", "Leave"],
    ["PR", "IN", "Incomplete"],
    ["IN", "AB", "Incomplete"],
    ["PL", "PR", "Present"],
    ["XX", "YY", "Unknown"],
  ])("%s + %s -> %s", (a, b, want) => expect(deriveStatus(a, b)).toBe(want));
});

describe("names and months", () => {
  it("normalises spelling noise", () => {
    expect(normalizeName("  SUSHOVAN   Haldar. ")).toBe("sushovan haldar");
    expect(normalizeName("Zoë  O'Neil")).toBe("zoe o neil");
  });
  it("converts month labels both ways and lists months", () => {
    expect(monthKeyOf("September 2026")).toBe("2026-09");
    expect(monthKeyOf("Sept 26")).toBeNull();
    expect(monthLabel("2026-09")).toBe("September 2026");
    expect(monthKeysBetween("2026-11", "2027-02")).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"]);
    expect(currentMonthKey(new Date("2026-10-02T00:00:00Z"))).toBe("2026-10");
  });
  it("counts working days as calendar days minus Sundays", () => {
    expect(workingDaysInMonth("2026-09")).toBe(26); // 30 days, 4 Sundays
    expect(workingDaysInMonth("2026-08")).toBe(26); // 31 days, 5 Sundays
  });
});

describe("full days and holidays", () => {
  it("has no half day: anyone who attended is Present and their hours are what is graded", () => {
    for (const mins of [null, 240, 480, 510, 600]) expect(dayOutcome("AB", "PR", mins, "2026-09-02")).toBe("Present");
  });
  it("makes a holiday a holiday for everyone, whatever the punches say", () => {
    const hol = new Set(["2026-09-18"]);
    expect(dayOutcome("AB", "AB", null, "2026-09-18", hol)).toBe("Holiday");
    expect(dayOutcome("IN", "AB", null, "2026-09-18", hol)).toBe("Holiday");
    expect(dayOutcome("AB", "AB", null, "2026-09-19", hol)).toBe("Absent");
  });
  it("treats a biometric holiday that we did not declare as a working day when the person punched in", () => {
    expect(dayOutcome("PH", "PH", 497, "2026-09-17", new Set(), true)).toBe("Present");
    expect(dayOutcome("PH", "PH", 519, "2026-09-17", new Set(), true)).toBe("Present");
    expect(dayOutcome("PH", "PH", null, "2026-09-17", new Set(), true)).toBe("Incomplete");
    expect(dayOutcome("PH", "PH", null, "2026-09-17")).toBe("Holiday"); // nobody came in: still a holiday
    expect(dayOutcome("PH", "PH", 519, "2026-09-17", new Set(["2026-09-17"]), true)).toBe("Holiday");
  });
  it("removes holidays (not Sundays twice) from the working days", () => {
    expect(workingDaysInMonth("2026-09", ["2026-09-18"])).toBe(25);
    expect(workingDaysInMonth("2026-09", ["2026-09-06"])).toBe(26); // a Sunday
    const recs = [
      { workDate: "2026-09-17", status: "Holiday" },
      { workDate: "2026-09-17", status: "Holiday" },
      { workDate: "2026-09-17", status: "Present" },
      { workDate: "2026-09-16", status: "Present" },
    ];
    expect([...holidayDates(["2026-09-18"], recs)].sort()).toEqual(["2026-09-17", "2026-09-18"]);
  });
});

describe("identity matching", () => {
  it("matches by biometric id first, even when the name is spelled differently", () => {
    expect(resolveIdentity({ cosecId: "D114", name: "SUSHOVAN HALDAR" }, ctx())).toMatchObject({
      kind: "matched", employeeId: "DLB-SUP-02", via: "cosec_id",
    });
  });
  it("falls back to name, then alias, and learns the id", () => {
    const noIds = ctx({ employees: EMPLOYEES.map(([id, name]) => ({ id, name, cosecId: null })) });
    expect(resolveIdentity({ cosecId: "D103", name: "SIBHU DAS" }, noIds)).toMatchObject({
      kind: "matched", employeeId: "DLB-SUP-03", via: "name", learnCosecId: true,
    });
    expect(resolveIdentity({ cosecId: "D115", name: "Gouranga Parui" }, noIds)).toMatchObject({
      kind: "matched", employeeId: "DLB-SUP-01", via: "alias", learnCosecId: true,
    });
  });
  it("never auto-links a near miss: it only suggests", () => {
    const r = resolveIdentity({ cosecId: "D777", name: "Sibhu Dass" }, ctx());
    expect(r).toMatchObject({ kind: "unmatched" });
    expect(r.kind === "unmatched" && r.suggestions[0]).toEqual({ employeeId: "DLB-SUP-03", name: "Sibhu Das" });
  });
  it("refuses a name match that contradicts the employee's known biometric id", () => {
    const r = resolveIdentity({ cosecId: "D999", name: "Deep Das" }, ctx());
    expect(r.kind).toBe("unmatched");
  });
  it("ignores excluded ids", () => {
    expect(resolveIdentity({ cosecId: "D112", name: "Santosh Kumar Yadav" }, ctx())).toMatchObject({ kind: "excluded" });
  });
});

describe("import plan for the September 2026 report", () => {
  it("maps the whole roster, drops only the excluded driver, and stores every other row", () => {
    const plan = planImport(report, ctx());
    expect(plan.stats).toMatchObject({
      monthKeys: ["2026-09"], rowsInFile: 390, rowsStored: 360, rowsExcluded: 30, rowsUnmatched: 0,
    });
    const outcomes = plan.stats.people.map((p) => [p.cosecId, p.outcome]);
    expect(outcomes.filter(([, o]) => o === "matched")).toHaveLength(12);
    expect(outcomes).toContainEqual(["D112", "excluded"]);
    expect(new Set(plan.rows.map((r) => r.employee_id)).size).toBe(12);
    expect(plan.rows.every((r) => r.employee_id !== null)).toBe(true);
    expect(plan.learn).toEqual([]);
  });

  it("flags anyone not on the roster instead of guessing, and still stores their rows", () => {
    const without = ctx({ employees: ctx().employees.filter((e) => e.id !== "DLB-SUP-07") });
    const plan = planImport(report, without);
    const sukhendu = plan.stats.people.find((p) => p.cosecId === "D108")!;
    expect(sukhendu).toMatchObject({ outcome: "unmatched", name: "Sukhendu Das", days: 30 });
    expect(sukhendu.suggestions).toEqual([]); // "Sibhu Das" is a different person, so it is not suggested
    expect(plan.stats.rowsUnmatched).toBe(30);
    expect(plan.rows.filter((r) => r.cosec_id === "D108").every((r) => r.employee_id === null)).toBe(true);
  });

  it("computes each person's month from the records (independently checked figures)", () => {
    const plan = planImport(report, ctx());
    const of = (id: string) => plan.stats.people.find((p) => p.cosecId === id)!.summary!;
    expect(of("D103")).toEqual({ presentDays: 24, totalHours: 171.4, absentDays: 2, leaveDays: 0, avgHours: 7.1, punctualityDeviation: 64 });
    expect(of("D115")).toEqual({ presentDays: 22, totalHours: 202.8, absentDays: 3, leaveDays: 0, avgHours: 9.2, punctualityDeviation: -7 });
    expect(of("D108")).toEqual({ presentDays: 25, totalHours: 214.8, absentDays: 1, leaveDays: 0, avgHours: 8.6, punctualityDeviation: -14 });
    expect(of("D113")).toMatchObject({ presentDays: 21, leaveDays: 3, absentDays: 2 });
  });
});
