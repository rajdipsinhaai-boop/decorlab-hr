import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getDocumentProxy } from "unpdf";
import { describe, expect, it } from "vitest";
import { buildReportCardPdf, winAnsi } from "@/lib/report/report-card.server";
import { mergeBullets } from "@/lib/report/model-for";
import { computeScore } from "@/lib/scoring/engine";
import { buildScoreCard } from "@/lib/scoring/score-card";
import type { AttDay, AuditPerson, RatingIn } from "@/lib/scoring/types";
import { DEFAULT_DUTY_RULES } from "@/lib/scoring/constants";

const RULES = DEFAULT_DUTY_RULES;
const OUT = process.env["REPORT_OUT"]; // set to a folder to keep the PDFs for a visual check

const day = (n: number, over: Partial<AttDay> = {}): AttDay => {
  const date = `2026-09-${String(n).padStart(2, "0")}`;
  return { workDate: date, status: "Present", inAt: `${date}T10:10:00`, workMin: 8.4 * 60, shift: "GS", ...over };
};
const audit = (over: Partial<AuditPerson> = {}): AuditPerson => ({
  dprDays: [],
  dprFilingDays: null,
  coveragePct: null,
  dprQuality: null,
  coordinationPct: null,
  coordinationBasis: "",
  activityDays: null,
  vendorOrders: null,
  flags: [],
  comments: { why: [], improve: [] },
  ...over,
});
const text = async (bytes: Uint8Array) => {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  let all = "";
  for (let p = 1; p <= pdf.numPages; p++) {
    const t = await (await pdf.getPage(p)).getTextContent();
    all += (t.items as { str: string }[]).map((i) => i.str).join(" ") + "\n";
  }
  return { all, pages: pdf.numPages };
};
const save = (name: string, bytes: Uint8Array) => {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), bytes);
};

function supervisor() {
  const days = Array.from({ length: 22 }, (_, i) => day(i + 1, i % 5 === 0 ? { inAt: `2026-09-${String(i + 1).padStart(2, "0")}T11:20:00` } : {}));
  const ratings: RatingIn[] = [
    ["Site Execution & Quality Control", 0.2, 5],
    ["Project Timeline Adherence", 0.2, 4],
    ["Team Management & Manpower Planning", 0.15, 4],
    ["Client Coordination & Satisfaction", 0.15, 4],
    ["Material & Vendor Management", 0.15, 3],
    ["Safety & Site Compliance", 0.1, 3],
    ["Cost & Budget Control", 0.05, 2],
  ].map(([name, weight, rating]) => ({ name: name as string, weight: weight as number, rating: rating as number }));
  const a = audit({
    dprDays: Array.from({ length: 10 }, (_, i) => ({
      date: `2026-09-${String(i + 1).padStart(2, "0")}`,
      grade: i < 8 ? "Poor" : "Good",
      score: i < 8 ? 25 : 75,
      blank: i < 8,
      project: "Mansingka",
      note: i < 8 ? "No update to show beyond a manpower count" : "Clear work log and plan",
    })),
    comments: { why: ["Filed reports stopped mentioning blockers after the 10th."], improve: [] },
  });
  const result = computeScore({ role: "supervisor", workingDays: 26, attendance: days, audit: a, ratings, rules: RULES });
  return { result, ratings, a, days };
}

describe("report card PDF", () => {
  it("renders a scored supervisor card with every section and the comments", async () => {
    const { result, ratings, a, days } = supervisor();
    const model = buildScoreCard({ name: "Arunava Mallick", role: "Site Supervisor", roleGroup: "supervisor", month: "September 2026", result, ratings, audit: a });
    const bytes = await buildReportCardPdf(model, { index: 4, total: 11 });
    save("supervisor.pdf", bytes);
    const { all } = await text(bytes);
    for (const needle of ["MONTHLY PERFORMANCE REPORT CARD", "Review Period: September 2026", "Arunava Mallick", "FINAL SCORE", "HOW THIS SCORE WAS BUILT", "Attendance (Visibility-Adjusted)", "DPR Combined Score", "System Work Feedback", "KRA BREAKDOWN", "Site Execution & Quality Control", "WHY THIS SCORE", "WHAT TO IMPROVE NEXT MONTH", "DECORLAB KRA", "4 / 11", "blank templates"]) {
      expect(all, needle).toContain(needle);
    }
    expect(model.finalScore).not.toBeNull();
    expect(days.length).toBe(22);
  });

  it("renders a pending designer card with an unrated parameter and an evidence page", async () => {
    const ratings: RatingIn[] = [
      { name: "Design Quality & Creativity", weight: 0.25, rating: 5 },
      { name: "Client Satisfaction & Feedback", weight: 0.2, rating: 4 },
      { name: "Timeline & Deadline Adherence", weight: 0.2, rating: 5 },
      { name: "Revision Efficiency (Rework Ratio)", weight: 0.15, rating: 4 },
      { name: "Technical / Drawing Accuracy", weight: 0.1, rating: 3 },
      { name: "Site Problem-Solving Skills", weight: 0.1, rating: null },
    ];
    const days = Array.from({ length: 24 }, (_, i) => day(i + 1));
    const a = audit({ coordinationPct: 100, coordinationBasis: "8 of 8 revision comments closed, same-day to ~3 days." });
    const result = computeScore({ role: "designer", workingDays: 26, attendance: days, audit: a, ratings, rules: RULES });
    const model = buildScoreCard({ name: "Bhavana Agarwal", roleGroup: "designer", month: "September 2026", result, ratings, audit: a });
    const bytes = await buildReportCardPdf(model, {
      evidence: {
        days: days.map((d) => ({ date: `${d.workDate.slice(8)}/09/2026`, day: "", status: "Present", inTime: "10:10", outTime: "18:30", hours: 8.4 })),
        dpr: [],
      },
    });
    save("designer-pending.pdf", bytes);
    const { all, pages } = await text(bytes);
    expect(all).toContain("NOT YET RATED");
    expect(all).toContain("WHAT IS STILL NEEDED");
    expect(all).toContain("director ratings (5 of 6 KRA parameters rated)");
    expect(all).toContain("Pending");
    expect(pages).toBeLessThanOrEqual(2);
  });

  it("keeps a full supervisor card with attendance and DPR evidence on two pages", async () => {
    const { result, ratings, a, days } = supervisor();
    const model = buildScoreCard({ name: "Arunava Mallick", role: "Site Supervisor", roleGroup: "supervisor", month: "September 2026", result, ratings, audit: a });
    const bytes = await buildReportCardPdf(model, {
      evidence: {
        days: days.map((d) => ({ date: `${d.workDate.slice(8)}/09/2026`, day: "", status: "Present", inTime: "10:10", outTime: "18:30", hours: 8.4 })),
        dpr: a.dprDays.map((d) => ({ date: d.date, grade: d.grade, summary: d.note, blockers: "", plan: "" })),
      },
    });
    save("supervisor-evidence.pdf", bytes);
    const { all, pages } = await text(bytes);
    expect(all).toContain("ATTENDANCE THIS MONTH");
    expect(all).toContain("DPR REPORTS GRADED");
    expect(pages).toBeLessThanOrEqual(2);
  });

  it("copes with long text and non-Latin characters without throwing", async () => {
    const result = computeScore({ role: "ea", workingDays: 26, attendance: [day(1)], audit: null, ratings: [{ name: "A", weight: 1, rating: 3 }], rules: RULES });
    const model = buildScoreCard({ name: "Priyanka Dalapati", roleGroup: "ea", month: "September 2026", result, ratings: [{ name: "A", weight: 1, rating: 3 }], audit: null });
    model.why = Array.from({ length: 30 }, (_, i) => `Point ${i}: ${"a long sentence that keeps going ".repeat(8)}→ ≥ 75% ✓ नमस्ते`);
    const bytes = await buildReportCardPdf(model);
    save("long.pdf", bytes);
    expect((await text(bytes)).pages).toBeGreaterThan(1);
    expect(winAnsi("a → b ≥ c ✓")).toBe("a -> b >= c ?");
  });

  it("merges the old line-wrapped narratives back into bullets", () => {
    expect(mergeBullets(["- First point that runs", "on to a second line", "- Second point", "> Third"])).toEqual([
      "First point that runs on to a second line",
      "Second point",
      "Third",
    ]);
  });
});
