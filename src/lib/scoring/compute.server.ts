import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { monthKeyOf, monthLabel, normalizeName } from "../attendance/normalize";
import { parseAudit } from "../audit-ingest";
import { selectAll } from "../db-util.server";
import { planMonthScores, type KraParam, type MonthEmployee, type RatingRow } from "./plan-month";
import { DEFAULT_DUTY_RULES } from "./constants";
import type { AuditPerson, DutyRule, RoleGroup } from "./types";

const db = () => supabaseAdmin as any;

export interface ComputeOutcome {
  monthKey: string;
  skipped: "finalized" | "legacy" | null;
  scored: number;
  pending: number;
}

/** Duty rules from the table, falling back to the agreed defaults for any role without a row. */
export function dutyRulesFrom(
  rows: { role_group: string; start_time: string; grace_min: number; required_min: number }[],
): Record<RoleGroup, DutyRule> {
  const out: Record<RoleGroup, DutyRule> = { ...DEFAULT_DUTY_RULES };
  for (const r of rows) {
    const [h, m] = String(r.start_time).split(":").map(Number);
    if (r.role_group in out) {
      out[r.role_group as RoleGroup] = {
        startMin: (h ?? 10) * 60 + (m ?? 0),
        graceMin: r.grace_min,
        requiredMin: r.required_min,
      };
    }
  }
  return out;
}

export async function isFinalized(monthKey: string): Promise<{ at: string; by: string } | null> {
  const { data, error } = await db().from("month_locks").select("*").eq("month_key", monthKey).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? { at: data.finalized_at, by: data.finalized_by } : null;
}

/** The newest monthly-kra-audit payload that names this month, matched to the roster. */
export async function loadAudit(
  monthKey: string,
  employees: MonthEmployee[],
  aliases: Map<string, string>,
): Promise<{ people: Map<string, AuditPerson>; claudeScores: Map<string, number>; receivedAt: string | null }> {
  const { data, error } = await db()
    .from("rdash_ingests")
    .select("payload, received_at")
    .order("received_at", { ascending: false })
    .limit(40);
  if (error) throw new Error(error.message);
  const roster = employees.map((e) => ({ employeeId: e.id, name: e.name }));
  for (const row of data ?? []) {
    const p = row.payload;
    if (p?.report !== "monthly-kra-audit" || monthKeyOf(String(p.review_month ?? "")) !== monthKey) continue;
    const parsed = parseAudit(p, roster, aliases);
    if (parsed.people.size) return { people: parsed.people, claudeScores: parsed.claudeScores, receivedAt: row.received_at };
  }
  return { people: new Map(), claudeScores: new Map(), receivedAt: null };
}

/**
 * Recomputes every score for a month from the three inputs (attendance, director ratings, the
 * Claude audit) and stores them. A finalized month, and the months that were scored in the
 * old spreadsheet, are left exactly as they are.
 */
export async function computeMonth(monthKey: string, opts: { force?: boolean } = {}): Promise<ComputeOutcome> {
  const outcome: ComputeOutcome = { monthKey, skipped: null, scored: 0, pending: 0 };
  if (await isFinalized(monthKey)) return { ...outcome, skipped: "finalized" };

  const legacy = await db()
    .from("monthly_scores")
    .select("employee_id", { count: "exact", head: true })
    .eq("month_key", monthKey)
    .eq("source", "legacy-sheet");
  if (legacy.error) throw new Error(legacy.error.message);
  if (legacy.count && !opts.force) return { ...outcome, skipped: "legacy" };

  const label = monthLabel(monthKey);
  const [emp, ali, params, rules, ratings, attendance] = await Promise.all([
    db().from("employees").select("id, name, role, role_group, status").order("id"),
    db().from("employee_aliases").select("alias_key, employee_id"),
    db().from("kra_parameters").select("*"),
    db().from("duty_rules").select("*"),
    db()
      .from("monthly_director_rating_details")
      .select("employee_id, kra_parameter, weight, rating_1_to_5")
      .eq("review_month", label),
    selectAll<any>((from, to) =>
      db()
        .from("attendance_records")
        .select("employee_id, work_date, status, in_at, work_min, shift")
        .eq("month_key", monthKey)
        .not("employee_id", "is", null)
        .range(from, to),
    ),
  ]);
  for (const r of [emp, ali, params, rules, ratings]) if (r.error) throw new Error(r.error.message);

  const employees: MonthEmployee[] = (emp.data ?? []).filter(
    (e: any) => String(e.status).toLowerCase() !== "inactive",
  );
  const aliasMap = new Map<string, string>((ali.data ?? []).map((a: any) => [normalizeName(a.alias_key), a.employee_id]));
  const audit = await loadAudit(monthKey, employees, aliasMap);

  const plan = planMonthScores({
    monthKey,
    employees,
    attendance: attendance.map((a: any) => ({
      employeeId: a.employee_id,
      workDate: a.work_date,
      status: a.status,
      inAt: a.in_at,
      workMin: a.work_min,
      shift: a.shift,
    })),
    ratings: (ratings.data ?? []) as RatingRow[],
    params: (params.data ?? []) as KraParam[],
    audit: audit.people,
    claudeScores: audit.claudeScores,
    rules: dutyRulesFrom(rules.data ?? []),
  });

  if (plan.rows.length) {
    const { error } = await db()
      .from("monthly_scores")
      .upsert(
        plan.rows.map((r) => ({ ...r, updated_at: new Date().toISOString() })),
        { onConflict: "month_key,employee_id" },
      );
    if (error) throw new Error(error.message);
  }
  return { ...outcome, scored: plan.summary.scored, pending: plan.summary.pending };
}

/** Never lets a scoring problem break the action that triggered it (an upload, a saved rating). */
export async function computeMonthSafely(monthKey: string): Promise<ComputeOutcome | { error: string }> {
  try {
    return await computeMonth(monthKey);
  } catch (error) {
    console.error(`Scoring ${monthKey} failed:`, error);
    return { error: (error as Error).message };
  }
}
