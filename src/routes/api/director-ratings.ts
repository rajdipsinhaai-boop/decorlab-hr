import { createFileRoute } from "@tanstack/react-router";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { SupabaseClient } from "@supabase/supabase-js";
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

export const Route = createFileRoute("/api/director-ratings")({
  server: {
    middleware: [requireSupabaseAuth],
    handlers: {
      GET: async ({ request, context }) => {
        try {
          await assertAdmin(context as unknown as ApiContext);
          const apiContext = context as unknown as ApiContext;
          const month = new URL(request.url).searchParams.get("month")?.trim();
          if (!month)
            return Response.json({ message: "A review month is required." }, { status: 400 });
          const { data, error } = await apiContext.supabase
            .from("monthly_director_ratings")
            .select(
              "id, review_month, employee_id, employee_name, director_rating, notes, updated_at",
            )
            .eq("review_month", month)
            .order("employee_name", { ascending: true });
          if (error) throw new Error(error.message);
          return Response.json({ ratings: data ?? [] });
        } catch (error) {
          return Response.json(
            {
              message: error instanceof Error ? error.message : "Could not load Director Ratings.",
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
            directorRating?: unknown;
            notes?: unknown;
          };
          const reviewMonth = String(body.reviewMonth ?? "").trim();
          const employeeId = String(body.employeeId ?? "").trim();
          const employeeName = String(body.employeeName ?? "").trim();
          const directorRating = Number(body.directorRating);
          const notes = body.notes == null ? null : String(body.notes).trim() || null;
          if (!reviewMonth || !employeeId || !employeeName) {
            return Response.json(
              { message: "Review month, employee ID, and employee name are required." },
              { status: 400 },
            );
          }
          if (!Number.isFinite(directorRating) || directorRating < 0 || directorRating > 100) {
            return Response.json(
              { message: "Director Rating must be a number from 0 to 100." },
              { status: 400 },
            );
          }
          const { data, error } = await apiContext.supabase
            .from("monthly_director_ratings")
            .upsert(
              {
                review_month: reviewMonth,
                employee_id: employeeId,
                employee_name: employeeName,
                director_rating: Math.round(directorRating * 100) / 100,
                notes,
                created_by: apiContext.userId,
                updated_by: apiContext.userId,
                updated_at: new Date().toISOString(),
              },
              { onConflict: "review_month,employee_id" },
            )
            .select(
              "id, review_month, employee_id, employee_name, director_rating, notes, updated_at",
            )
            .single();
          if (error) throw new Error(error.message);
          return Response.json({ rating: data });
        } catch (error) {
          return Response.json(
            { message: error instanceof Error ? error.message : "Could not save Director Rating." },
            { status: 403 },
          );
        }
      },
    },
  },
});
