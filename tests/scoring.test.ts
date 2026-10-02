import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain JS script, no type declarations
import { buildLegacy } from "../scripts/import-legacy.mjs";
import {
  attendanceBlend,
  dprStats,
  managerStats,
  visibility,
} from "@/lib/scoring/attendance-score";
import { combine, computeScore, rankMonth } from "@/lib/scoring/engine";
import { buildScoreCard } from "@/lib/scoring/score-card";
import type { AttDay, AuditPerson, DutyRule, RatingIn, RoleGroup, ScoreInput } from "@/lib/scoring/types";
import { DEFAULT_DUTY_RULES } from "@/lib/scoring/constants";

const load = (f: string) => JSON.parse(readFileSync(new URL(`../src/data/${f}`, import.meta.url), "utf8"));
const RULES: Record<RoleGroup, DutyRule> = DEFAULT_DUTY_RULES;

describe("final-score formulas reproduce every score the Google Sheet produced", () => {
  for (const file of ["fallback-dashboard.json", "august-dashboard.json"]) {
    const built = buildLegacy(load(file), new Map());
    it(`${built.label}: ${built.scores.length} people`, () => {
      const roleOf = (id: string) => (id.includes("SUP") ? "supervisor" : id.includes("DSG") ? "designer" : "ea");
      for (const s of built.scores) {
        const t: Record<string, string> = s.details.totals;
        const num = (...needles: string[]) => {
          for (const n of needles) {
            const k = Object.keys(t).find((x) => x.includes(n));
            if (k && !Number.isNaN(parseFloat(t[k]!))) return parseFloat(t[k]!);
          }
          return null;
        };
        const mgrRaw = num("manager rating")!;
        const feedback = mgrRaw <= 1 ? mgrRaw * 100 : mgrRaw;
        const role = roleOf(s.employee_id);
        const final = combine(role, {
          attendance: num("attendance score (discipline", "attendance score")!,
          dpr: num("dpr combined"),
          coordination: num("coordination score"),
          feedback,
        });
        expect(Math.abs(final - s.final_score), `${s.employee_id} ${s.final_score} vs ${final}`).toBeLessThanOrEqual(0.1);
      }
    });
  }

  it("ranks, Top 3, zones and company average match the sheet's own summary", () => {
    const july = buildLegacy(load("fallback-dashboard.json"), new Map());
    const rows = july.scores.map((s: { employee_id: string; final_score: number }) => ({
      id: s.employee_id,
      group: s.employee_id.includes("SUP") ? "supervisor" : s.employee_id.includes("DSG") ? "designer" : "ea",
      final: s.final_score,
    }));
    const r = rankMonth(rows);
    expect(r.companyAverage).toBe(52.3); // sheet: 52.26363636
    expect(r.zones).toEqual({ GREEN: 1, YELLOW: 3, RED: 7 });
    for (const s of july.scores) {
      const got = r.ranks.get(s.employee_id)!;
      // Company-wide rank and Top 3 match for everyone.
      expect([got.overallRank, got.isTop3]).toEqual([s.overall_rank, s.is_top3]);
      // The sheet ranked within the exact job title, so "Interior Designer (Head)" and
      // "Interior Designer" were ranked apart. We rank every designer together (what its own note says).
      if (!s.employee_id.includes("DSG")) expect(got.rankInRole).toBe(s.rank_in_role);
    }
    const designers = ["DLB-DSG-01", "DLB-DSG-04", "DLB-DSG-02", "DLB-DSG-03"].map((id) => r.ranks.get(id)!.rankInRole);
    expect(designers).toEqual([1, 2, 3, 4]); // Bhavana 90.9, Deep 66.1, Asif 37.1, Shibnath 31.6
  });
});

const day = (date: string, over: Partial<AttDay> = {}): AttDay => ({
  workDate: date,
  status: "Present",
  inAt: `${date}T10:05:00`,
  workMin: 9 * 60,
  shift: "GS",
  ...over,
});
const dates = (n: number) => Array.from({ length: n }, (_, i) => `2026-09-${String(i + 1).padStart(2, "0")}`);

describe("raw attendance = 70% presence + 20% hours + 10% punctuality", () => {
  it("is 100 for a full, on-time, full-hours month", () => {
    const b = attendanceBlend(dates(26).map((d) => day(d)), 26, RULES.designer);
    expect(b.raw).toBe(100);
  });
  it("blends the three parts", () => {
    // 20 of 26 days present, 9h each, all on time -> 0.7*0.769 + 0.2*1 + 0.1*1
    const b = attendanceBlend(dates(20).map((d) => day(d)), 26, RULES.designer);
    expect(b.presence).toBeCloseTo(20 / 26, 5);
    expect(b.raw).toBeCloseTo(100 * (0.7 * (20 / 26) + 0.2 + 0.1), 1);
  });
  it("penalises short days, and counts half days and missing punches as attended", () => {
    const days = [
      day("2026-09-01", { workMin: 6 * 60 }), // short day, arrived in time
      day("2026-09-02", { inAt: "2026-09-02T11:30:00", workMin: 7 * 60 }), // late AND short -> not on time
      day("2026-09-03", { status: "Half Day" }),
      day("2026-09-04", { status: "Incomplete", workMin: null }),
      day("2026-09-05", { status: "Absent", inAt: null, workMin: null }),
    ];
    const b = attendanceBlend(days, 5, RULES.designer);
    expect(b.attendedDays).toBe(4);
    expect(b.onTimeDays).toBe(3);
    expect(b.punctualitySample).toBe(4);
    expect(b.avgHours).toBe(7.3); // (6 + 7 + 9) / 3 days that have hours
  });
  it("a late arrival is fine if the full 8h30 duty is completed", () => {
    const late = (workMin: number) => attendanceBlend([day("2026-09-01", { inAt: "2026-09-01T11:40:00", workMin })], 1, RULES.designer);
    expect(late(8 * 60 + 30).onTimeDays).toBe(1); // 11:40 is well past 10:30, but 8h30 was worked
    expect(late(8 * 60 + 29).onTimeDays).toBe(0); // one minute short -> late
  });
  it("gives everyone a 30-minute grace period (designers 10:30, supervisors 11:30)", () => {
    const arrive = (role: RoleGroup, hhmm: string, workMin = 7 * 60) =>
      attendanceBlend([day("2026-09-01", { inAt: `2026-09-01T${hhmm}:00`, workMin })], 1, RULES[role]).onTimeDays;
    expect(arrive("designer", "10:30")).toBe(1);
    expect(arrive("designer", "10:31")).toBe(0);
    expect(arrive("supervisor", "11:30")).toBe(1);
    expect(arrive("supervisor", "11:31")).toBe(0);
    expect(arrive("supervisor", "10:00")).toBe(1); // early is always fine
  });
  it("treats missing hours or unreadable arrivals as neutral, not as a penalty", () => {
    const b = attendanceBlend([day("2026-09-01", { workMin: null, inAt: null })], 1, RULES.designer);
    expect(b.raw).toBe(100);
  });
});

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
const dpr = (date: string, grade = "Good", blank = false) => ({ date, grade, score: null, blank, project: "P", note: "" });

describe("work-visibility rule: present but nothing visible costs credit", () => {
  const present = ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04"];
  it("supervisor: only real DPRs on days present count", () => {
    const v = visibility(
      "supervisor",
      present,
      audit({
        dprDays: [
          dpr("2026-09-01"),
          dpr("2026-09-02", "Poor", true), // blank template -> not visible
          dpr("2026-09-03"),
          dpr("2026-09-09"), // filed on a day he was not present -> does not offset anything
        ],
      }),
    );
    expect(v).toMatchObject({ factor: 0.5, visibleDays: 2, presentDays: 4, basis: "dpr" });
  });
  it("supervisor with no DPR at all is fully penalised; with every day visible there is no penalty", () => {
    expect(visibility("supervisor", present, audit()).factor).toBe(0);
    expect(visibility("supervisor", present, audit({ dprDays: present.map((d) => dpr(d)) })).factor).toBe(1);
  });
  it("designer: activity days with a 50% floor; no activity data means no penalty", () => {
    expect(visibility("designer", present, audit({ activityDays: ["2026-09-01"] })).factor).toBe(0.5);
    expect(visibility("designer", present, audit({ activityDays: [] })).factor).toBe(0.5);
    expect(visibility("designer", present, audit({ activityDays: present })).factor).toBe(1);
    expect(visibility("designer", present, audit()).factor).toBeNull();
    expect(visibility("ea", present, null).factor).toBeNull();
  });
});

describe("DPR and feedback maths (checked against the July report cards)", () => {
  it("Arunava: 10 of 27 days, quality 30 -> coverage 37.0, combined 32.8", () => {
    const days = Array.from({ length: 10 }, (_, i) => ({
      date: `2026-07-${String(i + 1).padStart(2, "0")}`,
      grade: "Poor",
      score: i < 7 ? 25 : 41.67, // averages to 30
      blank: i < 8,
      project: "P",
      note: "",
    }));
    const s = dprStats(audit({ dprDays: days }), 27)!;
    expect(s.coveragePct).toBe(37);
    expect(s.qualityPct).toBeCloseTo(30, 0);
    expect(Math.abs(s.combined - 32.8)).toBeLessThanOrEqual(0.2);
    expect(s.blankDays).toBe(8);
  });
  it("uses the last filing of a day and the grade scale when no score is sent", () => {
    const s = dprStats(audit({ dprDays: [dpr("2026-09-01", "Poor"), dpr("2026-09-01", "Excellent"), dpr("2026-09-02", "Partial")] }), 26)!;
    expect(s.filingDays).toBe(2);
    expect(s.qualityPct).toBe(75); // (100 + 50) / 2
  });
  it("Bhavana's feedback is 79% with one parameter unrated (counted as 0)", () => {
    const r: RatingIn[] = [
      { name: "a", weight: 0.25, rating: 5 },
      { name: "b", weight: 0.2, rating: 4 },
      { name: "c", weight: 0.2, rating: 5 },
      { name: "d", weight: 0.15, rating: 4 },
      { name: "e", weight: 0.1, rating: 3 },
      { name: "f", weight: 0.1, rating: null },
    ];
    const m = managerStats(r);
    expect(m.percent).toBe(79);
    expect(m.unrated).toEqual(["f"]);
  });
});

describe("computeScore", () => {
  const ratings = (v: number | null): RatingIn[] => [
    { name: "Site Execution", weight: 0.5, rating: v },
    { name: "Timeline", weight: 0.5, rating: v },
  ];
  const base = (over: Partial<ScoreInput> = {}): ScoreInput => ({
    role: "supervisor",
    workingDays: 26,
    attendance: dates(26).map((d) => day(d)),
    audit: audit({ dprDays: dates(26).map((d) => dpr(d, "Excellent")) }),
    ratings: ratings(4),
    rules: RULES,
    ...over,
  });

  it("supervisor: attendance x30 + DPR x50 + feedback x20", () => {
    const r = computeScore(base());
    // attendance 100, DPR coverage 100 x.4 + quality 100 x.6 = 100, feedback 80
    expect(r).toMatchObject({ status: "scored", final: 96, rag: "GREEN" });
    expect(r.components.map((c) => [c.key, c.weight])).toEqual([
      ["attendance", 30],
      ["dpr", 50],
      ["feedback", 20],
    ]);
  });
  it("applies the visibility penalty to the attendance part", () => {
    const half = dates(26).map((d, i) => dpr(d, "Excellent", i % 2 === 1)); // every other report blank
    const r = computeScore(base({ audit: audit({ dprDays: half }) }));
    expect(r.facts.visibilityFactor).toBe(0.5);
    expect(r.facts.adjustedAttendance).toBe(50);
    expect(r.components[0]!.note).toContain("visible on only 13 of 26");
  });
  it("is Pending, naming what is missing, until ratings (and the audit) are in", () => {
    const noRatings = computeScore(base({ ratings: ratings(null) }));
    expect(noRatings).toMatchObject({ status: "pending", final: null, rag: null });
    expect(noRatings.missing[0]).toContain("director ratings (0 of 2");
    const noAudit = computeScore(base({ audit: null }));
    expect(noAudit.missing).toContain("the Claude DPR audit");
    expect(computeScore(base({ attendance: [] })).missing).toContain("the attendance upload");
  });
  it("designer: coordination counts; with none, attendance and feedback carry half each", () => {
    const withCoord = computeScore(base({ role: "designer", audit: audit({ coordinationPct: 100, coordinationBasis: "8/8 closed" }) }));
    expect(withCoord.components.map((c) => c.weight)).toEqual([25, 40, 35]);
    expect(withCoord.final).toBe(Math.round((100 * 25 + 100 * 40 + 80 * 35) / 10) / 10);
    const none = computeScore(base({ role: "designer", audit: audit() }));
    expect(none.components.map((c) => c.weight)).toEqual([50, 50]);
    expect(none.final).toBe(90);
  });
  it("EA: attendance x60 + feedback x40", () => {
    expect(computeScore(base({ role: "ea", audit: null })).final).toBe(Math.round(100 * 0.6 * 10 + 80 * 0.4 * 10) / 10);
  });
});

describe("attendanceBlend", () => {
  it("scores 0 when nobody attended, instead of paying out the neutral hours/punctuality parts", () => {
    const rule = { startMin: 11 * 60, graceMin: 30, requiredMin: 510 };
    const absent = attendanceBlend(
      [{ workDate: "2026-09-01", status: "Absent", inAt: null, workMin: null }],
      26,
      rule,
    );
    expect(absent.raw).toBe(0);
    const here = attendanceBlend(
      [{ workDate: "2026-09-01", status: "Present", inAt: "2026-09-01T11:05:00", workMin: 510 }],
      1,
      rule,
    );
    expect(here.raw).toBe(100);
  });
});

describe("rankMonth", () => {
  it("shares a rank on a tie and skips the next one; leaves unscored people out", () => {
    const r = rankMonth([
      { id: "a", group: "supervisor", final: 80 },
      { id: "b", group: "supervisor", final: 70 },
      { id: "c", group: "designer", final: 70 },
      { id: "d", group: "ea", final: null },
    ]);
    expect(r.ranks.get("b")).toEqual({ rankInRole: 2, overallRank: 2, isTop3: true });
    expect(r.ranks.get("c")).toEqual({ rankInRole: 1, overallRank: 2, isTop3: true });
    expect(r.ranks.get("d")).toEqual({ rankInRole: null, overallRank: null, isTop3: false });
    expect(r.companyAverage).toBe(73.3);
  });
});

describe("report card model and comments", () => {
  it("names the real reasons in plain words", () => {
    const ratings: RatingIn[] = [
      { name: "Site Execution", weight: 0.4, rating: 5 },
      { name: "Cost Control", weight: 0.4, rating: 0 },
      { name: "Safety", weight: 0.2, rating: 2 },
    ];
    const input: ScoreInput = {
      role: "supervisor",
      workingDays: 27,
      attendance: dates(22).map((d) => day(d)),
      audit: audit({
        dprDays: dates(10).map((d, i) => dpr(d, "Poor", i < 8)),
        comments: { why: ["Report quality dropped in the last week."], improve: [] },
      }),
      ratings,
      rules: RULES,
    };
    const result = computeScore(input);
    const card = buildScoreCard({ name: "Test Person", roleGroup: "supervisor", month: "September 2026", result, ratings, audit: input.audit });
    expect(card.pending).toEqual([]);
    expect(card.kra).toEqual([
      { name: "Site Execution", rating: 5 },
      { name: "Cost Control", rating: 0 },
      { name: "Safety", rating: 2 },
    ]);
    const why = card.why.join(" ");
    expect(why).toContain("a real update was visible on only");
    expect(why).toContain("blank templates");
    expect(why).toContain("Cost Control was rated 0");
    expect(why).toContain("Report quality dropped in the last week.");
    expect(card.improve.join(" ")).toContain("File a DPR every working day");
    expect(why).toContain("Safety was rated low");
    expect(card.improve.join(" ")).toContain("what is behind the low rating on Cost Control and Safety");
  });
  it("an unrated parameter keeps the score Pending and the card says which one", () => {
    const ratings: RatingIn[] = [
      { name: "A", weight: 0.5, rating: 4 },
      { name: "Site Problem-Solving Skills", weight: 0.5, rating: null },
    ];
    const result = computeScore({ role: "ea", workingDays: 26, attendance: dates(24).map((d) => day(d)), audit: null, ratings, rules: RULES });
    expect(result.status).toBe("pending");
    const card = buildScoreCard({ name: "X", roleGroup: "ea", month: "September 2026", result, ratings, audit: null });
    expect(card.kra[1]).toEqual({ name: "Site Problem-Solving Skills", rating: null });
    expect(card.pending[0]).toContain("1 of 2");
  });
  it("a pending card says what it is waiting for", () => {
    const result = computeScore({ role: "ea", workingDays: 26, attendance: dates(20).map((d) => day(d)), audit: null, ratings: [], rules: RULES });
    const card = buildScoreCard({ name: "X", roleGroup: "ea", month: "September 2026", result, ratings: [], audit: null });
    expect(card.finalScore).toBeNull();
    expect(card.why[0]).toContain("waiting for director ratings");
  });
});
