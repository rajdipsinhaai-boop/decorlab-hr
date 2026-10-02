import { supabase } from "@/integrations/supabase/client";
import type { DashboardView } from "@/lib/hr-types";

/** Loads the dashboard for a month ("" = the latest month that has data). Shared so the cache is shared. */
export async function fetchDashboard(month: string): Promise<DashboardView> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error("Your session has expired. Please sign in again.");
  const query = month ? `?month=${encodeURIComponent(month)}` : "";
  const response = await fetch(`/api/dashboard${query}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.message ?? payload?.error ?? "Could not load the dashboard.");
  }
  return payload as DashboardView;
}
