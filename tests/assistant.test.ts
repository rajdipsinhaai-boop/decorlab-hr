import { describe, expect, it } from "vitest";
import { compactContext } from "@/lib/assistant.server";

describe("assistant context", () => {
  it("gives the model each person's parts, reasons and the scoring rules for the month", () => {
    const data = {
      month: "September 2026",
      locked: null,
      targetHours: 8.5,
      employees: [
        {
          name: "Deep Das", role: "Interior Designer", score: 88, rag: "GREEN", rankInRole: 3, overallRank: 3,
          card: {
            components: [{ label: "Attendance", weight: 50, score: 93.9, note: "Worked 199.5h of 212.5h expected" }],
            why: ["Strong month at 88%."], improve: ["Keep it up."], pending: [],
          },
          criteria: [{ name: "Design Quality", weight: 0.25, rating: 5, rated: true }],
          presentDays: 25, leaveDays: 0, absentDays: 0, totalHours: 199.5, avgHours: 8, filingDiscipline: null,
        },
      ],
    } as never;
    const c = compactContext(data);
    expect(c.howScoresWork).toContain("hours worked / (working days x 8.5h)");
    expect(c.howScoresWork).toContain("2 warnings per calendar year");
    expect(c.employees[0]).toMatchObject({
      name: "Deep Das",
      score: 88,
      hoursWorked: 199.5,
      parts: [{ part: "Attendance", weight: 50, score: 93.9, explanation: "Worked 199.5h of 212.5h expected" }],
      whyThisScore: ["Strong month at 88%."],
    });
  });
});

describe("assistant history across months", () => {
  it("lists every month per person with the average, and a company average per month", async () => {
    const { compactHistory } = await import("@/lib/assistant.server");
    const row = (month: string, id: string, score: number | null, extra = {}) => ({
      month_key: month, employee_id: id, final_score: score, rag: score === null ? null : "GREEN", rank_in_role: 1, overall_rank: 1,
      breakdown: [{ label: "Attendance", weight: 25, score: 90 }], details: null, ...extra,
    });
    const h = compactHistory(
      [
        row("2026-09", "A", 80, { details: { facts: { workedHours: 190, expectedHours: 212.5, warningUsed: true } } }),
        row("2026-07", "A", 60),
        row("2026-08", "A", 70),
        row("2026-09", "B", 90),
        row("2026-10", "B", null),
      ],
      new Map([["A", "Asha"], ["B", "Bela"]]),
    );
    const asha = h.people.find((p) => p.name === "Asha")!;
    expect(asha.months.map((m) => m.month)).toEqual(["July 2026", "August 2026", "September 2026"]); // oldest first
    expect(asha.averageScore).toBe(70);
    expect(asha.monthsScored).toBe(3);
    expect(asha.months[2]).toMatchObject({ hoursWorked: 190, warningUsed: true });
    expect(h.people.find((p) => p.name === "Bela")).toMatchObject({ averageScore: 90, monthsScored: 1 }); // the pending month is skipped
    expect(h.companyAveragePerMonth.find((m) => m.month === "September 2026")).toEqual({ month: "September 2026", average: 85, people: 2 });
  });
});
