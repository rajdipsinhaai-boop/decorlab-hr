import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

// Runs the real migration on an in-process Postgres, after stubbing the pieces Supabase provides.
const MIGRATION = readFileSync(
  new URL("../supabase/migrations/202610020002_attendance_pipeline.sql", import.meta.url),
  "utf8",
);

let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema storage;
    create table storage.buckets (id text primary key, name text, public boolean);
  `);
  await db.exec(MIGRATION);
});

const rows = (r: { rows: unknown[] }) => r.rows as Record<string, unknown>[];

describe("attendance pipeline migration", () => {
  it("seeds the roster, aliases, exclusions and the private bucket", async () => {
    expect(rows(await db.query("select count(*)::int n from employees"))[0]!["n"]).toBe(12);
    expect(rows(await db.query("select cosec_id from employees where id = 'DLB-SUP-02'"))[0]!["cosec_id"]).toBe("D114");
    expect(rows(await db.query("select employee_id from employee_aliases where alias_key = 'gouranga parui'"))[0]!["employee_id"]).toBe("DLB-SUP-01");
    expect(rows(await db.query("select reason from attendance_exclusions where cosec_id = 'D112'"))).toHaveLength(1);
    expect(rows(await db.query("select public from storage.buckets where id = 'attendance-uploads'"))[0]!["public"]).toBe(false);
  });

  it("is safe to run twice", async () => {
    await db.exec(MIGRATION);
    expect(rows(await db.query("select count(*)::int n from employees"))[0]!["n"]).toBe(12);
  });

  it("imports records idempotently and keeps an existing mapping when a re-upload cannot map", async () => {
    const up = rows(await db.query(`insert into attendance_uploads (filename, file_sha256, uploaded_by) values ('a.xlsx','x','t') returning id`))[0]!["id"];
    const row = (over: Record<string, unknown> = {}) => ({
      month_key: "2026-09", work_date: "2026-09-01", cosec_id: "D100", employee_id: "DLB-SUP-05",
      raw_name: "RANJAN MAITY", shift: "ES", in_at: "2026-09-01T12:10:59", out_at: "2026-09-01T18:19:55",
      in2_at: null, out2_at: null, first_half: "AB", second_half: "PR", status: "Half Day",
      late_in_min: null, early_out_min: 71, work_min: 369, manual_entry: false, reason: null, ...over,
    });
    const run = async (r: unknown[]) =>
      rows(await db.query("select import_attendance_records($1, $2::jsonb) n", [up, JSON.stringify(r)]))[0]!["n"];

    expect(await run([row(), row({ work_date: "2026-09-02", cosec_id: "D999", employee_id: null, raw_name: "Nobody" })])).toBe(2);
    expect(await run([row({ work_min: 400 })])).toBe(1); // same person/day: updated, not duplicated
    expect(await run([row({ employee_id: null })])).toBe(1); // unmapped re-upload does not erase the link
    const all = rows(await db.query("select cosec_id, employee_id, work_min, in_at::text, status from attendance_records order by cosec_id"));
    expect(all).toEqual([
      { cosec_id: "D100", employee_id: "DLB-SUP-05", work_min: 369, in_at: "2026-09-01 12:10:59", status: "Half Day" },
      { cosec_id: "D999", employee_id: null, work_min: 369, in_at: "2026-09-01 12:10:59", status: "Half Day" },
    ]);
  });

  it("rejects a status outside the allowed set", async () => {
    await expect(
      db.query(`insert into attendance_records (month_key, work_date, cosec_id, raw_name, status) values ('2026-09','2026-09-30','D1','x','Bogus')`),
    ).rejects.toThrow();
  });

  it("hands each job to one worker, honours types, retries stale work and fails exhausted jobs", async () => {
    await db.exec("delete from jobs");
    const mk = async (type: string, extra = "") =>
      rows(await db.query(`insert into jobs (type, payload ${extra ? ", " + extra.split("=")[0] : ""}) values ($1, '{}'${extra ? ", " + extra.split("=")[1] : ""}) returning id`, [type]))[0]!["id"] as string;
    const a = await mk("attendance.import");
    await mk("other");

    const claim = async (types: string[] | null = null, id: string | null = null) =>
      rows(await db.query("select * from claim_job('w1', $1, $2)", [types, id]));

    const first = await claim(["attendance.import"]);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ id: a, status: "running", attempts: 1, locked_by: "w1" });
    expect(await claim(["attendance.import"])).toHaveLength(0); // already running, not stale

    // a crashed worker: lock older than the stale window -> picked up again
    await db.query("update jobs set locked_at = now() - interval '1 hour' where id = $1", [a]);
    expect(await claim(["attendance.import"])).toMatchObject([{ id: a, attempts: 2 }]);

    // out of attempts and stale -> failed, never handed out again
    await db.query("update jobs set locked_at = now() - interval '1 hour', attempts = max_attempts where id = $1", [a]);
    expect(await claim(["attendance.import"])).toHaveLength(0);
    expect(rows(await db.query("select status from jobs where id = $1", [a]))[0]!["status"]).toBe("failed");

    // future run_after is not claimable yet
    await db.exec("delete from jobs");
    await db.query("insert into jobs (type, run_after) values ('t', now() + interval '1 hour')");
    expect(await claim()).toHaveLength(0);
  });
});
