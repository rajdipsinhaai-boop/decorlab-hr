import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain JS script, no type declarations
import { buildLegacy } from "../scripts/import-legacy.mjs";

const load = (f: string) => JSON.parse(readFileSync(new URL(`../src/data/${f}`, import.meta.url), "utf8"));
const COSEC = new Map(
  Object.entries({ D100: "DLB-SUP-05", D102: "DLB-SUP-04", D103: "DLB-SUP-03", D108: "DLB-SUP-07", D114: "DLB-SUP-02", D115: "DLB-SUP-01", D116: "DLB-SUP-06", D104: "DLB-DSG-04", D105: "DLB-DSG-02", D109: "DLB-DSG-01", D111: "DLB-DSG-03", D113: "DLB-EA-01" }),
);

describe("legacy snapshot import", () => {
  for (const [file, label, people, attendance] of [
    ["fallback-dashboard.json", "July 2026", 11, 341],
    ["august-dashboard.json", "August 2026", 12, 372],
  ] as const) {
    describe(label, () => {
      const built = buildLegacy(load(file), COSEC);

      it("reads the month, every scored person and every attendance row", () => {
        expect(built.label).toBe(label);
        expect(built.scores).toHaveLength(people);
        expect(built.attendance).toHaveLength(attendance);
        expect(built.attendance.every((r: { employee_id: string | null }) => r.employee_id !== null)).toBe(true);
      });

      it("rebuilds every weighted breakdown so it adds up to the sheet's own final score", () => {
        for (const s of built.scores) {
          const sum = s.breakdown.reduce((a: number, b: { contribution: number }) => a + b.contribution, 0);
          expect(Math.abs(sum - s.final_score), `${s.employee_id} ${s.final_score} vs ${sum}`).toBeLessThanOrEqual(0.25);
        }
      });
    });
  }

  it("keeps ranks, RAG, the top-3 flag and the discipline figure", () => {
    const july = buildLegacy(load("fallback-dashboard.json"), COSEC);
    const sibhu = july.scores.find((s: { employee_id: string }) => s.employee_id === "DLB-SUP-03");
    expect(sibhu).toMatchObject({ final_score: 68.2, rag: "YELLOW", rank_in_role: 1, overall_rank: 3, is_top3: true });
    expect(sibhu.details.filing_discipline_pct).toBe(81.5);
  });

  it("uses a 50/50 attendance and feedback split for a designer with no coordination data", () => {
    const july = buildLegacy(load("fallback-dashboard.json"), COSEC);
    const deep = july.scores.find((s: { employee_id: string }) => s.employee_id === "DLB-DSG-04");
    expect(deep.breakdown.map((b: { label: string; weight: number }) => [b.label, b.weight])).toEqual([
      ["Attendance", 50],
      ["System Work Feedback", 50],
    ]);
  });

  it("carries the August roster addition (Sukhendu Das)", () => {
    const aug = buildLegacy(load("august-dashboard.json"), COSEC);
    expect(aug.scores.find((s: { employee_id: string }) => s.employee_id === "DLB-SUP-07")).toMatchObject({ final_score: 65.3, rag: "YELLOW" });
  });
});
