import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

const sql = (f: string) => readFileSync(new URL(`../supabase/migrations/${f}`, import.meta.url), "utf8");
let db: PGlite;
const q = async (text: string, params: unknown[] = []) => (await db.query(text, params)).rows as Record<string, unknown>[];

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema storage; create table storage.buckets (id text primary key, name text, public boolean);
    create table monthly_director_rating_details (id uuid primary key default gen_random_uuid(), review_month text not null,
      employee_id text not null, employee_name text not null, kra_parameter text not null, rating_1_to_5 numeric not null
      check (rating_1_to_5 >= 0 and rating_1_to_5 <= 5));
    create table rdash_ingests (id uuid primary key default gen_random_uuid(), payload jsonb not null, received_at timestamptz default now());`);
  await db.exec(sql("202610020002_attendance_pipeline.sql"));
  await db.exec(sql("202610030001_scoring.sql"));
});

describe("scoring migration", () => {
  it("defines the KRA parameters from the sheet, with weights that add up to 100% per role", async () => {
    const rows = await q("select role_group, count(*)::int n, round(sum(weight), 4)::float total from kra_parameters group by role_group order by role_group");
    expect(rows).toEqual([
      { role_group: "designer", n: 6, total: 1 },
      { role_group: "ea", n: 6, total: 1 },
      { role_group: "supervisor", n: 7, total: 1 },
    ]);
  });
  it("seeds the shift start times and the private report-card bucket", async () => {
    expect((await q("select shift_code, start_time::text, grace_min from shift_rules order by shift_code")).map((r) => r["shift_code"])).toEqual(["DR", "ES", "GS"]);
    expect((await q("select public from storage.buckets where id = 'report-cards'"))[0]!["public"]).toBe(false);
  });
  it("lets a director rating be blank (not rated) while still rejecting out-of-range values", async () => {
    await q("insert into monthly_director_rating_details (review_month, employee_id, employee_name, kra_parameter, rating_1_to_5) values ('September 2026','E1','A','K1', null)");
    await q("insert into monthly_director_rating_details (review_month, employee_id, employee_name, kra_parameter, rating_1_to_5) values ('September 2026','E1','A','K2', 0)");
    expect((await q("select count(*)::int n from monthly_director_rating_details where rating_1_to_5 is null"))[0]!["n"]).toBe(1);
    await expect(q("insert into monthly_director_rating_details (review_month, employee_id, employee_name, kra_parameter, rating_1_to_5) values ('September 2026','E1','A','K3', 9)")).rejects.toThrow();
  });
  it("locks a month once and is safe to run twice", async () => {
    await q("insert into month_locks (month_key, finalized_by) values ('2026-09', 'a@b.c')");
    await expect(q("insert into month_locks (month_key, finalized_by) values ('2026-09', 'x')")).rejects.toThrow();
    await db.exec(sql("202610030001_scoring.sql"));
    expect((await q("select count(*)::int n from kra_parameters"))[0]!["n"]).toBe(19);
  });
});
