import { createFileRoute } from "@tanstack/react-router";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { DashboardView } from "@/lib/hr-types";
import { loadDashboard } from "@/lib/hr.server";

async function assertAllowed(context: { supabase: any; claims: any }) {
  const { resolveAccess } = await import("@/lib/access.server");
  return resolveAccess(context);
}

export const Route = createFileRoute("/api/dashboard")({
  server: {
    middleware: [requireSupabaseAuth],
    handlers: {
      GET: async ({ request, context }) => {
        const { role, employeeId, employeeName } = await assertAllowed(context as never);
        const requestedMonth = new URL(request.url).searchParams.get("month") ?? "July 2026";
        const data = await loadDashboard(requestedMonth);
        if (role === "manager") {
          const own =
            data.employees.find(
              (employee) =>
                (employeeId && employee.id === employeeId) ||
                (employeeName && employee.name.toLowerCase() === employeeName.toLowerCase()),
            ) ?? null;
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
          const employee =
            data.employees.find(
              (candidate) =>
                (employeeId && candidate.id === employeeId) ||
                (employeeName && candidate.name.toLowerCase() === employeeName.toLowerCase()),
            ) ?? null;
          return Response.json({
            viewerRole: "employee",
            month: data.month,
            employee,
          } satisfies DashboardView);
        }
        return Response.json({ viewerRole: "admin", data } satisfies DashboardView);
      },
    },
  },
});
