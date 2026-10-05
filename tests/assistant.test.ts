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
