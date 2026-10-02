import { createFileRoute } from "@tanstack/react-router";
import { ingestAuthorized } from "@/lib/ingest-auth.server";

/**
 * Read-only monthly attendance per person, for the Claude KRA audit (replaces the old
 * attendance_summary.json / COSEC lookup).  GET ?month=September%202026  (or 2026-09)
 * Same shared secret as the ingest endpoint: header "x-ingest-key".
 */
async function handle(request: Request) {
  if (!ingestAuthorized(request)) return new Response("Unauthorized", { status: 401 });

  const { monthKeyOf, monthLabel } = await import("@/lib/attendance/normalize");
  const { workingDaysInMonth } = await import("@/lib/attendance/metrics");
  const asked = new URL(request.url).searchParams.get("month") ?? "";
  const key = /^\d{4}-\d{2}$/.test(asked) ? asked : monthKeyOf(asked);
  if (!key) {
    return Response.json({ ok: false, error: 'Pass ?month=September 2026 (or 2026-09).' }, { status: 400 });
  }

  const { loadDashboard } = await import("@/lib/hr.server");
  const data = await loadDashboard(monthLabel(key));
  if (data.month !== monthLabel(key)) {
    return Response.json({ ok: false, error: `No data for ${monthLabel(key)}.` }, { status: 404 });
  }
  const info = data.monthInfo.find((m) => m.month === data.month);
  return Response.json({
    ok: true,
    month: data.month,
    attendance_uploaded: info?.hasAttendance ?? false,
    working_days: workingDaysInMonth(key),
    people: data.employees.map((e) => ({
      name: e.name,
      group: e.roleGroup,
      present_days: e.hasAttendance ? e.presentDays : null,
      half_days: e.hasAttendance ? e.halfDays : null,
      absent_days: e.hasAttendance ? e.absentDays : null,
      leave_days: e.hasAttendance ? e.leaveDays : null,
      avg_hours: e.hasAttendance ? e.avgHours : null,
      punctuality_minutes_vs_10am: e.hasAttendance ? e.punctualityDeviation : null,
    })),
  });
}

export const Route = createFileRoute("/api/public/attendance-summary")({
  server: { handlers: { GET: ({ request }) => handle(request) } },
});
