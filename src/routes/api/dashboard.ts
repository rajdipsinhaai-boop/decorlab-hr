import { createFileRoute } from "@tanstack/react-router";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { DashboardView } from "@/lib/hr-types";
import { loadDashboard } from "@/lib/hr.server";
import { findOwn } from "@/lib/access.server";

async function assertAllowed(context: { supabase: any; claims: any }) {
  const { resolveAccess } = await import("@/lib/access.server");
  return resolveAccess(context);
}

async function respond(request: Request, context: unknown): Promise<Response> {
  const { role, employeeId, employeeName } = await assertAllowed(context as never);
  // No month (or an unknown one) shows the most recent month that has data.
  const requestedMonth = new URL(request.url).searchParams.get("month") || undefined;
  const data = await loadDashboard(requestedMonth);

  if (role === "manager") {
    const own = findOwn(data.employees, { employeeId, employeeName });
    const response: DashboardView = {
      viewerRole: "manager",
      month: data.month,
      months: data.months,
      own,
      roster: data.employees.map((employee) => ({
        id: employee.id,
        name: employee.name,
        role: employee.role,
        roleGroup: employee.roleGroup,
      })),
    };
    return Response.json(response);
  }
  if (role === "employee") {
    const employee = findOwn(data.employees, { employeeId, employeeName });
    return Response.json({
      viewerRole: "employee",
      month: data.month,
      employee,
    } satisfies DashboardView);
  }
  return Response.json({ viewerRole: "admin", data } satisfies DashboardView);
}

const MISSING_TABLES =
  /review_months|schema cache|does not exist|Could not find the (table|function)/i;

export const Route = createFileRoute("/api/dashboard")({
  server: {
    middleware: [requireSupabaseAuth],
    handlers: {
      GET: async ({ request, context }) => {
        try {
          return await respond(request, context);
        } catch (error) {
          // Say what actually went wrong instead of an unexplained 500.
          const message = error instanceof Error ? error.message : "Could not load the dashboard.";
          console.error("Dashboard failed:", error);
          return Response.json(
            {
              message: MISSING_TABLES.test(message)
                ? `The database is missing the attendance tables (${message}). Apply supabase/migrations/202610020002_attendance_pipeline.sql, then reload.`
                : message,
            },
            { status: 500 },
          );
        }
      },
    },
  },
});
