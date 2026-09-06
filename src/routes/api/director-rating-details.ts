import { createFileRoute } from "@tanstack/react-router";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";

const ADMIN_EMAILS = (process.env.ACCESS_ADMIN_EMAILS ?? "rajdipsinhaai@gmail.com")
  .split(",")
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);

type ApiContext = {
  supabase: SupabaseClient<Database>;
  claims: Record<string, unknown>;
  userId: string;
};

async function assertAdmin(context: ApiContext) {
  const email = String(context.claims?.email ?? "").toLowerCase();
  if (ADMIN_EMAILS.includes(email)) return;
  const { data, error } = await context.supabase
    .from("allowed_emails")
    .select("role")
    .ilike("email", email)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || data.role !== "admin") throw new Error("Administrator access is required.");
}

export const Route = createFileRoute("/api/director-rating-details")({
  server: {
    middleware: [requireSupabaseAuth],
    handlers: {
      GET: async ({ request, context }) => {
        try {
          const apiContext = context as unknown as ApiContext;
          await assertAdmin(apiContext);
          const month = new URL(request.url).searchParams.get("month")?.trim();
          if (!month)
            return Response.json({ message: "A review month is required." }, { status: 400 });
          const { data, error } = await apiContext.supabase
            .from("monthly_director_rating_details")
            .select(
              "id, review_month, employee_id, employee_name, role, kra_parameter, weight, rating_1_to_5, weighted_score, source_tab, notes, updated_at",
            )
            .eq("review_month", month)
            .order("employee_name", { ascending: true })
            .order("kra_parameter", { ascending: true });
          if (error) throw new Error(error.message);
          return Response.json({ ratings: data ?? [] });
        } catch (error) {
          return Response.json(
            {
              message:
                error instanceof Error
                  ? error.message
                  : "Could not load detailed Director Ratings.",
            },
            { status: 403 },
          );
        }
      },
      PUT: async ({ request, context }) => {
        try {
          const apiContext = context as unknown as ApiContext;
          await assertAdmin(apiContext);
          const body = (await request.json()) as {
            reviewMonth?: unknown;
            employeeId?: unknown;
            employeeName?: unknown;
            role?: unknown;
            kraParameter?: unknown;
            weight?: unknown;
            rating1To5?: unknown;
            weightedScore?: unknown;
            sourceTab?: unknown;
            notes?: unknown;
          };
          const reviewMonth = String(body.reviewMonth ?? "").trim();
          const employeeId = String(body.employeeId ?? "").trim();
          const employeeName = String(body.employeeName ?? "").trim();
          const role = String(body.role ?? "").trim();
          const kraParameter = String(body.kraParameter ?? "").trim();
          const rating1To5 = Number(body.rating1To5);
          const weight = body.weight == null || body.weight === "" ? null : Number(body.weight);
          const weightedScore =
            body.weightedScore == null || body.weightedScore === ""
              ? null
              : Number(body.weightedScore);
          const sourceTab = String(body.sourceTab ?? "").trim();
          const notes = body.notes == null ? null : String(body.notes).trim() || null;
          if (!reviewMonth || !employeeId || !employeeName || !kraParameter) {
            return Response.json(
              { message: "Review month, employee, employee name, and KRA parameter are required." },
              { status: 400 },
            );
          }
          if (!Number.isFinite(rating1To5) || rating1To5 < 0 || rating1To5 > 5) {
            return Response.json(
              { message: "Rating must be a number from 0 to 5." },
              { status: 400 },
            );
          }
          if (weight !== null && !Number.isFinite(weight)) {
            return Response.json({ message: "Weight must be numeric." }, { status: 400 });
          }
          if (weightedScore !== null && !Number.isFinite(weightedScore)) {
            return Response.json({ message: "Weighted score must be numeric." }, { status: 400 });
          }
          const { data, error } = await apiContext.supabase
            .from("monthly_director_rating_details")
            .upsert(
              {
                review_month: reviewMonth,
                employee_id: employeeId,
                employee_name: employeeName,
                role,
                kra_parameter: kraParameter,
                weight,
                rating_1_to_5: Math.round(rating1To5 * 100) / 100,
                weighted_score: weightedScore,
                source_tab: sourceTab,
                notes,
                updated_by: apiContext.userId,
                updated_at: new Date().toISOString(),
              },
              { onConflict: "review_month,employee_id,kra_parameter" },
            )
            .select(
              "id, review_month, employee_id, employee_name, role, kra_parameter, weight, rating_1_to_5, weighted_score, source_tab, notes, updated_at",
            )
            .single();
          if (error) throw new Error(error.message);
          return Response.json({ rating: data });
        } catch (error) {
          return Response.json(
            {
              message:
                error instanceof Error ? error.message : "Could not save detailed Director Rating.",
            },
            { status: 403 },
          );
        }
      },
    },
  },
});
