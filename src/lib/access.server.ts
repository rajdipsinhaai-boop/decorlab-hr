import type { ViewerRole } from "./hr-types";
import { isOpenSignupEnabled } from "./access-policy";

export type Access = {
  email: string;
  role: ViewerRole;
  employeeId: string | null;
  employeeName: string | null;
};

type Ctx = { supabase: any; claims: any };

const list = (name: string) =>
  (process.env[name] ?? "")
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);

/** Env-configured access: ACCESS_ADMIN_EMAILS, ACCESS_MANAGER_EMAILS, ACCESS_PROFILES_JSON. */
function configuredAccess(email: string): Omit<Access, "email"> | null {
  if (list("ACCESS_ADMIN_EMAILS").includes(email))
    return { role: "admin", employeeId: null, employeeName: null };
  let profile: any = null;
  try {
    profile = JSON.parse(process.env["ACCESS_PROFILES_JSON"] ?? "{}").profiles?.[email] ?? null;
  } catch {
    // malformed JSON: ignore and fall through
  }
  if (!profile && list("ACCESS_MANAGER_EMAILS").includes(email)) profile = { role: "manager" };
  if (!["admin", "manager", "employee"].includes(profile?.role)) return null;
  return {
    role: profile.role,
    employeeId: typeof profile.employeeId === "string" ? profile.employeeId : null,
    employeeName: typeof profile.employeeName === "string" ? profile.employeeName : null,
  };
}

/** Single source of truth for who a signed-in user is. Fails closed on DB errors. */
export async function resolveAccess(context: Ctx): Promise<Access> {
  const email = String(context.claims?.email ?? "").toLowerCase();
  if (!email) throw new Error("No email on this account.");
  const configured = configuredAccess(email);
  if (configured) return { email, ...configured };

  let { data, error } = await context.supabase
    .from("allowed_emails")
    .select("email, role, employee_id, employee_name")
    .ilike("email", email)
    .maybeSingle();
  if (error) {
    // older schema without employee_id/employee_name columns
    ({ data, error } = await context.supabase
      .from("allowed_emails")
      .select("email, role")
      .ilike("email", email)
      .maybeSingle());
  }
  if (error) throw new Error("Could not verify access. Try again shortly.");
  if (!data) {
    if (isOpenSignupEnabled())
      return { email, role: "employee", employeeId: null, employeeName: null };
    throw new Error("Your account is not on the Decorlab HR access list.");
  }
  return {
    email,
    role:
      data.role === "leadership" || data.role === "admin"
        ? "admin"
        : data.role === "manager"
          ? "manager"
          : "employee",
    employeeId: data.employee_id ?? null,
    employeeName: data.employee_name ?? null,
  };
}
