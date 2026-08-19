import { createFileRoute } from "@tanstack/react-router";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { DashboardView, ViewerRole } from "@/lib/hr-types";
import { loadDashboard } from "@/lib/hr.server";

async function assertAllowed(context: {
  supabase: any;
  claims: any;
}): Promise<{ email: string; role: ViewerRole }> {
  const email = (context.claims?.email ?? "").toString().toLowerCase();
  if (!email) throw new Error("No email on this account.");
  const { data, error } = await context.supabase
    .from("allowed_emails")
    .select("email, role")
    .ilike("email", email)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Your account is not on the Decorlab HR access list.");
  return { email, role: (data.role as ViewerRole) ?? "leadership" };
}

export const Route = createFileRoute("/api/dashboard")({
  server: {
    middleware: [requireSupabaseAuth],
    handlers: {
      GET: async ({ context }) => {
        const { role } = await assertAllowed(context as never);
        const data = await loadDashboard();
        if (role === "manager") {
          const response: DashboardView = {
            viewerRole: "manager",
            month: data.month,
            months: data.months,
            roster: data.employees.map((employee) => ({
              id: employee.id,
              name: employee.name,
              role: employee.role,
              roleGroup: employee.roleGroup,
            })),
          };
          return Response.json(response);
        }
        return Response.json({ viewerRole: "leadership", data } satisfies DashboardView);
      },
    },
  },
});
