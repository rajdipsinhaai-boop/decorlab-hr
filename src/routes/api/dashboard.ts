import { createFileRoute } from "@tanstack/react-router";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { DashboardView, ViewerRole } from "@/lib/hr-types";
import { loadDashboard } from "@/lib/hr.server";
import { isOpenSignupEnabled } from "@/lib/access-policy";

function configuredProfile(
  email: string,
): { role: ViewerRole; employeeId: string | null; employeeName: string | null } | null {
  const admins = (process.env.ACCESS_ADMIN_EMAILS ?? "rajdipsinhaai@gmail.com")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (admins.includes(email)) return { role: "admin", employeeId: null, employeeName: null };
  try {
    const profiles = JSON.parse(process.env.ACCESS_PROFILES_JSON ?? "{}").profiles ?? {};
    const profile = profiles[email] ?? (email === "adey020@gmail.com" ? { role: "manager" } : null);
    if (!profile) return null;
    const role =
      profile.role === "admin" || profile.role === "manager" || profile.role === "employee"
        ? profile.role
        : null;
    if (!role) return null;
    return {
      role,
      employeeId: typeof profile.employeeId === "string" ? profile.employeeId : null,
      employeeName: typeof profile.employeeName === "string" ? profile.employeeName : null,
    };
  } catch {
    return null;
  }
}

async function assertAllowed(context: { supabase: any; claims: any }): Promise<{
  email: string;
  role: ViewerRole;
  employeeId: string | null;
  employeeName: string | null;
}> {
  const email = (context.claims?.email ?? "").toString().toLowerCase();
  if (!email) throw new Error("No email on this account.");
  const configured = configuredProfile(email);
  if (configured) return { email, ...configured };
  let data: any;
  let error: any;
  ({ data, error } = await context.supabase
    .from("allowed_emails")
    .select("email, role, employee_id, employee_name")
    .ilike("email", email)
    .maybeSingle());
  if (error) {
    ({ data, error } = await context.supabase
      .from("allowed_emails")
      .select("email, role")
      .ilike("email", email)
      .maybeSingle());
  }
  if (error && isOpenSignupEnabled()) {
    return { email, role: "employee", employeeId: null, employeeName: null };
  }
  if (error) throw new Error(error.message);
  if (!data) {
    if (isOpenSignupEnabled()) {
      return { email, role: "employee", employeeId: null, employeeName: null };
    }
    throw new Error("Your account is not on the Decorlab HR access list.");
  }
  const role =
    data.role === "leadership" || data.role === "admin"
      ? "admin"
      : data.role === "manager"
        ? "manager"
        : "employee";
  return {
    email,
    role,
    employeeId: data.employee_id ?? null,
    employeeName: data.employee_name ?? null,
  };
}

export const Route = createFileRoute("/api/dashboard")({
  server: {
    middleware: [requireSupabaseAuth],
    handlers: {
      GET: async ({ context }) => {
        const { role, employeeId, employeeName } = await assertAllowed(context as never);
        const data = await loadDashboard();
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
