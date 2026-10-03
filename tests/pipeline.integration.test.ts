import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
// @ts-expect-error plain JS script, no type declarations
import { buildLegacy } from "../scripts/import-legacy.mjs";
import { parseAudit } from "@/lib/audit-ingest";
import { planMonthScores } from "@/lib/scoring/plan-month";
import { dutyRulesFrom } from "@/lib/scoring/compute.server";
import { normalizeName } from "@/lib/attendance/normalize";
import { parseAttendanceFile } from "@/lib/attendance/parse.server";
import { planImport } from "@/lib/attendance/plan";
import type { MatchContext } from "@/lib/attendance/match";
import { assembleDashboard, planMonths, type AttendanceRow, type EmployeeRow, type MonthRow, type ScoreRow } from "@/lib/dashboard-build";

/**
 * The whole pipeline on a real Postgres engine: migration -> legacy history -> a September upload
 * (Excel, then the PDF of the same report) -> a Claude audit -> the dashboard for every month.
 * Only the supabase-js transport is absent; each query below mirrors the one in hr.server.ts.
 */
const read = (p: string) => readFileSync(new URL(p, import.meta.url));
const NOW = "2026-10"; // "today" for the month list

let db: PGlite;
const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows as T[];

async function matchContext(): Promise<MatchContext> {
  const emp = await q<{ id: string; name: string; cosec_id: string | null }>("select id, name, cosec_id from employees");
  const ali = await q<{ alias_key: string; employee_id: string }>("select alias_key, employee_id from employee_aliases");
  const exc = await q<{ cosec_id: string; reason: string }>("select cosec_id, reason from attendance_exclusions");
  return {
    employees: emp.map((e) => ({ id: e.id, name: e.name, cosecId: e.cosec_id })),
    aliases: new Map(ali.map((a) => [normalizeName(a.alias_key), a.employee_id])),
    excluded: new Map(exc.map((x) => [x.cosec_id, x.reason])),
  };
}

async function importFile(file: string) {
  const report = await parseAttendanceFile(new Uint8Array(read(`./fixtures/${file}`)));
  const plan = planImport(report, await matchContext());
  await q("select import_attendance_records(null, $1::jsonb)", [JSON.stringify(plan.rows)]);
  for (const l of plan.learn) await q("update employees set cosec_id = $2 where id = $1 and cosec_id is null", [l.employeeId, l.cosecId]);
  return plan;
}

async function dashboard(requested?: string) {
  const plan = planMonths(await q<MonthRow>("select * from review_months()"), requested, NOW);
  const key = plan.monthKey;
  return assembleDashboard({
    plan,
    employees: await q<EmployeeRow>("select * from employees order by id"),
    attendance: await q<AttendanceRow>(
      `select employee_id, work_date::text, status, to_char(in_at, 'YYYY-MM-DD"T"HH24:MI:SS') in_at,
              to_char(out_at, 'YYYY-MM-DD"T"HH24:MI:SS') out_at, work_min
         from attendance_records where month_key = $1 and employee_id is not null order by work_date`,
      [key],
    ),
    scores: await q<ScoreRow>("select * from monthly_scores where month_key = $1", [key]),
    ratings: [],
    trend: await q("select month_key, final_score from monthly_scores where final_score is not null"),
    narratives: {},
  });
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
                 create schema storage; create table storage.buckets (id text primary key, name text, public boolean);`);
  await db.exec(readFileSync(new URL("../supabase/migrations/202610020002_attendance_pipeline.sql", import.meta.url), "utf8"));
  // tables from earlier migrations that the scoring migration alters
  await db.exec(`create table monthly_director_rating_details (
      id uuid primary key default gen_random_uuid(), review_month text not null, employee_id text not null,
      employee_name text not null, role text not null default '', kra_parameter text not null, weight numeric,
      rating_1_to_5 numeric not null, weighted_score numeric, source_tab text not null default '', notes text,
      updated_at timestamptz default now(), unique (review_month, employee_id, kra_parameter));
    create table rdash_ingests (id uuid primary key default gen_random_uuid(), source text, payload jsonb not null, received_at timestamptz default now());`);
  await db.exec(readFileSync(new URL("../supabase/migrations/202610030001_scoring.sql", import.meta.url), "utf8"));
  await db.exec(readFileSync(new URL("../supabase/migrations/202610030002_duty_rules.sql", import.meta.url), "utf8"));

  // July and August history, exactly as scripts/import-legacy.mjs writes it.
  const cosec = new Map((await q<{ id: string; cosec_id: string }>("select id, cosec_id from employees")).map((e) => [e.cosec_id, e.id]));
  for (const f of ["fallback-dashboard.json", "august-dashboard.json"]) {
    const built = buildLegacy(JSON.parse(read(`../src/data/${f}`).toString("utf8")), cosec);
    for (const s of built.scores) {
      await q(
        `insert into monthly_scores (month_key, employee_id, final_score, rag, rank_in_role, overall_rank, is_top3, breakdown, criteria, note, details, source)
         values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11::jsonb,$12)`,
        [s.month_key, s.employee_id, s.final_score, s.rag, s.rank_in_role, s.overall_rank, s.is_top3, JSON.stringify(s.breakdown), JSON.stringify(s.criteria), s.note, JSON.stringify(s.details), s.source],
      );
    }
    await q("select import_attendance_records(null, $1::jsonb)", [JSON.stringify(built.attendance)]);
  }
});

describe("month list", () => {
  it("runs from the first month on record to the present, newest first, and flags empty months", async () => {
    const d = await dashboard();
    expect(d.months).toEqual(["October 2026", "September 2026", "August 2026", "July 2026"]);
    expect(d.monthInfo.map((m) => [m.month, m.hasAttendance, m.hasScores])).toEqual([
      ["October 2026", false, false],
      ["September 2026", false, false],
      ["August 2026", true, true],
      ["July 2026", true, true],
    ]);
    // September has nothing yet, so the default is the newest month that does
    expect(d.month).toBe("August 2026");
  });
});

describe("legacy months now come from the database", () => {
  it("serves July with its scores, ranks, breakdowns and attendance", async () => {
    const d = await dashboard("July 2026");
    expect(d.month).toBe("July 2026");
    expect(d.employees).toHaveLength(11);
    const sibhu = d.employees.find((e) => e.name === "Sibhu Das")!;
    expect(sibhu).toMatchObject({ score: 68.2, rag: "YELLOW", rankInRole: 1, isTop3: true, hasAttendance: true, filingDiscipline: 81.5 });
    expect(sibhu.breakdown.map((b) => b.weight)).toEqual([30, 50, 20]);
    expect(sibhu.days.length).toBe(31);
  });
  it("serves August with the extra supervisor and a per-month trend", async () => {
    const d = await dashboard("August 2026");
    expect(d.employees).toHaveLength(12);
    expect(d.employees.find((e) => e.name === "Sukhendu Das")).toMatchObject({ score: 65.3, rag: "YELLOW" });
    expect(d.trend.map((t) => [t.month, t.scored])).toEqual([["July 2026", 11], ["August 2026", 12]]);
    expect(d.trend[0]!.average).not.toBe(d.trend[1]!.average);
  });
});

describe("September upload", () => {
  it("maps the roster from the Excel export; the driver is never stored", async () => {
    const plan = await importFile("cosec-sept-2026.xlsx");
    expect(plan.stats).toMatchObject({ rowsStored: 360, rowsExcluded: 30, rowsUnmatched: 0 });
    expect(await q("select count(*)::int n from attendance_records where month_key = '2026-09'")).toEqual([{ n: 360 }]);
    expect(await q("select count(*)::int n from attendance_records where cosec_id = 'D112'")).toEqual([{ n: 0 }]);
  });

  it("shows September on the dashboard as the latest month, unscored, with computed attendance", async () => {
    const d = await dashboard();
    expect(d.month).toBe("September 2026");
    expect(d.monthInfo[1]).toEqual({ month: "September 2026", hasAttendance: true, hasScores: false });
    expect(d.employees).toHaveLength(12);
    const sibhu = d.employees.find((e) => e.name === "Sibhu Das")!;
    expect(sibhu).toMatchObject({ score: null, rag: null, presentDays: 24, absentDays: 2, avgHours: 7.1, punctualityDeviation: 4, hasAttendance: true });
    expect(sibhu.days).toHaveLength(30);
    expect(sibhu.days[0]).toMatchObject({ date: "01/09/2026", day: "Tuesday", status: "Present", inTime: "11:30", outTime: "18:41" });
    expect(d.employees.every((e) => e.score === null)).toBe(true);
  });

  it("re-uploading the same month as the PDF changes nothing that matters (no duplicates)", async () => {
    const before = await dashboard("September 2026");
    await importFile("cosec-sept-2026.pdf");
    expect(await q("select count(*)::int n from attendance_records where month_key = '2026-09'")).toEqual([{ n: 360 }]);
    const after = await dashboard("September 2026");
    const metrics = (d: typeof before) => d.employees.map((e) => [e.name, e.presentDays, e.totalHours, e.absentDays, e.leaveDays, e.avgHours, e.punctualityDeviation]);
    expect(metrics(after)).toEqual(metrics(before));
  });

  it("computes real scores from attendance + Claude audit + director ratings, and shows Pending until complete", async () => {
    const monthKey = "2026-09";
    const compute = async (payload: unknown) => {
      const employees = await q<{ id: string; name: string; role: string; role_group: "supervisor" | "designer" | "ea" }>("select id, name, role, role_group from employees");
      const aliases = new Map((await q<{ alias_key: string; employee_id: string }>("select * from employee_aliases")).map((a) => [a.alias_key, a.employee_id]));
      const audit = parseAudit(payload, employees.map((e) => ({ employeeId: e.id, name: e.name })), aliases);
      const att = await q<{ employee_id: string; work_date: string; status: string; in_at: string | null; work_min: number | null; shift: string | null }>(
        `select employee_id, work_date::text, status, to_char(in_at, 'YYYY-MM-DD"T"HH24:MI:SS') in_at, work_min, shift
           from attendance_records where month_key = $1 and employee_id is not null`, [monthKey]);
      const plan = planMonthScores({
        monthKey,
        employees,
        attendance: att.map((a) => ({ employeeId: a.employee_id, workDate: a.work_date, status: a.status, inAt: a.in_at, workMin: a.work_min, shift: a.shift })),
        ratings: await q("select employee_id, kra_parameter, weight, rating_1_to_5 from monthly_director_rating_details where review_month = 'September 2026'"),
        params: (await q<{ role_group: "supervisor" | "designer" | "ea"; name: string; weight: string; sort: number }>("select * from kra_parameters")).map((p) => ({ ...p, weight: Number(p.weight) })),
        audit: audit.people,
        rules: dutyRulesFrom(await q<{ role_group: string; start_time: string; grace_min: number; required_min: number }>("select role_group, start_time::text, grace_min, required_min from duty_rules")),
      });
      for (const r of plan.rows) {
        await q(
          `insert into monthly_scores (month_key, employee_id, final_score, rag, rank_in_role, overall_rank, is_top3, breakdown, criteria, note, details, source)
           values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11::jsonb,$12)
           on conflict (month_key, employee_id) do update set final_score = excluded.final_score, rag = excluded.rag, rank_in_role = excluded.rank_in_role,
             overall_rank = excluded.overall_rank, is_top3 = excluded.is_top3, breakdown = excluded.breakdown, criteria = excluded.criteria, note = excluded.note, details = excluded.details`,
          [r.month_key, r.employee_id, r.final_score, r.rag, r.rank_in_role, r.overall_rank, r.is_top3, JSON.stringify(r.breakdown), JSON.stringify(r.criteria), r.note, JSON.stringify(r.details), r.source],
        );
      }
      return { plan, audit };
    };
    const rate = async (employeeId: string, rating: number | null) => {
      const emp = (await q<{ name: string; role: string; role_group: string }>("select name, role, role_group from employees where id = $1", [employeeId]))[0]!;
      for (const p of await q<{ name: string; weight: string }>("select name, weight from kra_parameters where role_group = $1", [emp.role_group])) {
        await q(
          `insert into monthly_director_rating_details (review_month, employee_id, employee_name, role, kra_parameter, weight, rating_1_to_5)
           values ('September 2026', $1, $2, $3, $4, $5, $6) on conflict (review_month, employee_id, kra_parameter) do update set rating_1_to_5 = excluded.rating_1_to_5`,
          [employeeId, emp.name, emp.role, p.name, Number(p.weight), rating],
        );
      }
    };
    const payload = {
      report: "monthly-kra-audit", status: "complete", review_month: "September 2026",
      people: [
        { name: "SUSHOVAN HALDAR", group: "supervisor", flags: ["tomorrow plan never filled"],
          dpr: { days: Array.from({ length: 14 }, (_, i) => ({ date: `2026-09-${String(i + 1).padStart(2, "0")}`, project: "Mansingka", grade: "Good", score: 75, blank: false, note: "Clear plan" })) },
          comments: { why: ["Reports were consistent through the first half."], improve: [] } },
        { name: "Bhavana Agarwal", group: "designer", metrics: { coordination_pct: 100 }, coordination_basis: "8 of 8 revision comments closed", activity_days: [] },
        { name: "Someone New", group: "supervisor" },
      ],
    };

    // 1) Before ratings: attendance + audit exist, so people are Pending (and nothing is invented)
    let { plan, audit } = await compute(payload);
    expect(audit.skipped).toEqual([{ name: "Someone New", reason: "not on the roster" }]);
    expect(plan.summary).toMatchObject({ scored: 0, pending: 12 });
    let d = await dashboard("September 2026");
    expect(d.employees.every((e) => e.score === null && e.card?.pending.length)).toBe(true);
    const sus = d.employees.find((e) => e.name === "Susovan Haldar")!;
    expect(sus.card!.pending.join(" ")).toContain("director ratings");
    expect(sus.card!.components.map((c) => c.label)).toEqual(["Attendance (Visibility-Adjusted)", "DPR Combined Score", "System Work Feedback"]);

    // 2) Director ratings arrive for two people -> they are scored, the rest stay Pending
    await rate("DLB-SUP-02", 4);
    await rate("DLB-DSG-01", 5);
    ({ plan } = await compute(payload));
    expect(plan.summary.scored).toBe(2);
    d = await dashboard("September 2026");
    const susScored = d.employees.find((e) => e.name === "Susovan Haldar")!;
    const bhavana = d.employees.find((e) => e.name === "Bhavana Agarwal")!;
    expect(susScored.score).not.toBeNull();
    expect(susScored.score).toBeGreaterThan(0);
    expect(susScored.rag).toBe(susScored.score! >= 75 ? "GREEN" : susScored.score! >= 60 ? "YELLOW" : "RED");
    expect(susScored.card!.why.join(" ")).toContain("Reports were consistent through the first half.");
    expect(susScored.dprActivity).toHaveLength(14);
    expect(bhavana.card!.components.map((c) => c.weight)).toEqual([25, 40, 35]);
    expect(bhavana.card!.components[0]!.note).toContain("visible on only 0 of");
    expect(bhavana.score).not.toBeNull();
    expect([susScored.overallRank, bhavana.overallRank].sort()).toEqual([1, 2]);
    expect(d.employees.filter((e) => e.score === null)).toHaveLength(10);
    expect(d.monthInfo[1]).toEqual({ month: "September 2026", hasAttendance: true, hasScores: true });
    expect(d.trend.map((t) => t.month)).toEqual(["July 2026", "August 2026", "September 2026"]);

    // 3) One KRA point is saved as "not rated": blank is not 0, and the score goes back to Pending
    await q("update monthly_director_rating_details set rating_1_to_5 = null where employee_id = 'DLB-SUP-02' and kra_parameter = 'Cost & Budget Control'");
    ({ plan } = await compute(payload));
    d = await dashboard("September 2026");
    const susPending = d.employees.find((e) => e.name === "Susovan Haldar")!;
    expect(susPending.score).toBeNull();
    expect(susPending.card!.kra.find((k) => k.name === "Cost & Budget Control")!.rating).toBeNull();
    expect(susPending.card!.pending.join(" ")).toContain("6 of 7");
  });

  it("a finalized month reports its lock", async () => {
    await q("insert into month_locks (month_key, finalized_by) values ('2026-09', 'test@example.com')");
    expect((await q<{ month_key: string }>("select month_key from month_locks"))[0]!.month_key).toBe("2026-09");
  });

  it("an unknown month falls back to the latest month with data, never to a stale hardcoded one", async () => {
    expect((await dashboard("March 2031")).month).toBe("September 2026");
    expect((await dashboard("garbage")).month).toBe("September 2026");
    expect((await dashboard("October 2026")).month).toBe("October 2026"); // current month, still empty
    expect((await dashboard("October 2026")).employees.every((e) => !e.hasAttendance && e.score === null)).toBe(true);
  });
});
