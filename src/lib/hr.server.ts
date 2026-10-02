import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { selectAll } from "./db-util.server";
import { batchGet } from "./sheets.server";
import { fallbackBatchGet } from "./fallback.server";
import reportCards from "@/data/report-cards.json";
import { currentMonthKey, monthLabel } from "./attendance/normalize";
import { dutyRulesFrom } from "./scoring/compute.server";
import {
  assembleDashboard,
  planMonths,
  type AttendanceRow,
  type EmployeeRow,
  type MonthRow,
  type Narrative,
  type RatingRow,
  type ScoreRow,
} from "./dashboard-build";
import type { ControlRow, DashboardData } from "./hr-types";

// The roster, attendance, scores and jobs tables are not in the generated Supabase types yet.
const db = () => supabaseAdmin as any;

/** Hand-written report-card text that exists for some past months (keyed by lowercase employee name). */
const NARRATIVES = reportCards as Record<string, Narrative & { pdfFilename: string; pdfBase64: string }>;

/**
 * The dashboard for one month, read from the database: the roster, the parsed attendance records
 * and that month's scores. With no month given (or an unknown one) it shows the most recent month
 * that has data.
 */
export async function loadDashboard(requestedMonth?: string): Promise<DashboardData> {
  const months = await db().rpc("review_months");
  if (months.error) throw new Error(months.error.message);
  const plan = planMonths((months.data ?? []) as MonthRow[], requestedMonth, currentMonthKey());
  const key = plan.monthKey;

  const [emp, attendance, scores, ratings, trend, lock, duty] = await Promise.all([
    db().from("employees").select("*").order("id"),
    selectAll<AttendanceRow>((from, to) =>
      db()
        .from("attendance_records")
        .select("employee_id, work_date, status, in_at, out_at, work_min")
        .eq("month_key", key)
        .not("employee_id", "is", null)
        .order("work_date")
        .range(from, to),
    ),
    db().from("monthly_scores").select("*").eq("month_key", key),
    db()
      .from("monthly_director_rating_details")
      .select("employee_id, kra_parameter, weight, rating_1_to_5")
      .eq("review_month", monthLabel(key)),
    db().from("monthly_scores").select("month_key, final_score").not("final_score", "is", null),
    db().from("month_locks").select("*").eq("month_key", key).maybeSingle(),
    db().from("duty_rules").select("*"),
  ]);
  for (const r of [emp, scores, ratings, trend, lock, duty]) if (r.error) throw new Error(r.error.message);

  return assembleDashboard({
    plan,
    employees: (emp.data ?? []) as EmployeeRow[],
    attendance,
    scores: (scores.data ?? []) as ScoreRow[],
    ratings: (ratings.data ?? []) as RatingRow[],
    trend: trend.data ?? [],
    narratives: NARRATIVES,
    locked: lock.data ? { at: lock.data.finalized_at, by: lock.data.finalized_by } : null,
    rules: dutyRulesFrom(duty.data ?? []),
  });
}

const cell = (row: string[] | undefined, i: number) => (row?.[i] ?? "").toString().trim();

/** Request rows still kept in the Control sheet (WhatsApp exports and report requests). */
export async function loadControlRows(): Promise<ControlRow[]> {
  const range = "Control!A3:H500";
  let grid: string[][];
  try {
    grid = (await batchGet([range]))[range] ?? [];
  } catch (error) {
    console.warn("Google Sheets unavailable; using the attached workbook Control fallback.", error);
    grid = fallbackBatchGet([range])[range] ?? [];
  }
  return grid.slice(1).flatMap((row) => {
    const requestId = cell(row, 0);
    if (!requestId) return [];
    const rawType = cell(row, 7);
    const type = rawType.toLowerCase().includes("attendance")
      ? "Attendance Upload"
      : rawType.toLowerCase().includes("whatsapp")
        ? "WhatsApp Export"
        : "Create Report";
    return [
      {
        requestId,
        requestedAt: cell(row, 1),
        requestedBy: cell(row, 2),
        month: cell(row, 3),
        status: cell(row, 4).toUpperCase(),
        driveLink: cell(row, 5),
        completedAt: cell(row, 6),
        type: type as ControlRow["type"],
      },
    ];
  });
}
