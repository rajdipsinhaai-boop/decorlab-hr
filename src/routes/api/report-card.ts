import { createFileRoute } from "@tanstack/react-router";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import reportCards from "@/data/report-cards.json";
import type { ViewerRole } from "@/lib/hr-types";
import { loadDashboard } from "@/lib/hr.server";
import { buildReportCard } from "@/lib/cron/report-pdf.server";
import type { Database } from "@/integrations/supabase/types";

type Snapshot = {
  month: string;
  scoreBuilt: string[];
  whyScore: string[];
  improveNextMonth: string[];
  pdfFilename: string;
  pdfBase64: string;
};

const REPORT_CARDS = reportCards as Record<string, Snapshot>;

type Profile = { role: ViewerRole; employeeId: string | null; employeeName: string | null };
type AuthClaims = { email?: string | null };

type AuthContext = {
  supabase: SupabaseClient<Database>;
  claims: AuthClaims;
};

async function resolveProfile(context: AuthContext): Promise<Profile> {
  const email = String(context.claims?.email ?? "").toLowerCase();
  const admins = (process.env["ACCESS_ADMIN_EMAILS"] ?? "rajdipsinhaai@gmail.com")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (admins.includes(email)) return { role: "admin", employeeId: null, employeeName: null };

  try {
    const profiles = JSON.parse(process.env["ACCESS_PROFILES_JSON"] ?? "{}").profiles ?? {};
    const configured =
      profiles[email] ??
      (["adey020@gmail.com", "mundigenius@gmail.com"].includes(email) ? { role: "manager" } : null);
    if (configured) {
      return {
        role: configured.role === "employee" ? "employee" : "manager",
        employeeId: typeof configured.employeeId === "string" ? configured.employeeId : null,
        employeeName: typeof configured.employeeName === "string" ? configured.employeeName : null,
      };
    }
  } catch {
    // Fall through to the database allow-list.
  }

  const { data, error } = await context.supabase
    .from("allowed_emails")
    .select("email, role, employee_id, employee_name")
    .ilike("email", email)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Your account is not on the Decorlab HR access list.");
  return {
    role: data.role === "admin" ? "admin" : data.role === "manager" ? "manager" : "employee",

    employeeId: data.employee_id ?? null,
    employeeName: data.employee_name ?? null,
  };
}

export const Route = createFileRoute("/api/report-card")({
  server: {
    middleware: [requireSupabaseAuth as never],
    handlers: {
      GET: async ({ request, context }) => {
        const params = new URL(request.url).searchParams;
        const name = params.get("name")?.trim() ?? "";
        if (!name) return new Response("Missing employee name", { status: 400 });
        const month = params.get("month") === "August 2026" ? "August 2026" : "July 2026";

        const profile = await resolveProfile(context as never);
        const isAdmin = profile.role === "admin";
        const isOwn = Boolean(
          profile.employeeName && profile.employeeName.toLowerCase() === name.toLowerCase(),
        );
        if (!isAdmin && !isOwn) return new Response("Not authorized", { status: 403 });

        const record = REPORT_CARDS[name.toLowerCase()];
        let bytes: Uint8Array;
        let filename: string;
        if (month === "July 2026" && record?.pdfBase64) {
          bytes = Buffer.from(record.pdfBase64, "base64");
          filename = record.pdfFilename;
        } else {
          const dashboard = await loadDashboard(month);
          const employee = dashboard.employees.find(
            (entry) => entry.name.toLowerCase() === name.toLowerCase(),
          );
          if (!employee) return new Response("Report card not found", { status: 404 });
          bytes = await buildReportCard(employee, dashboard.month);
          filename = `${employee.name} - Report Card - ${dashboard.month}.pdf`;
        }

        return new Response(bytes as unknown as BodyInit, {
          headers: {
            "Content-Type": "application/pdf",
            "Content-Length": String(bytes.byteLength),
            "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
            "Cache-Control": "private, no-store",
          },
        });
      },
    },
  },
});
