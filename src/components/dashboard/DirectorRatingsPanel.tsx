import { useEffect, useMemo, useState } from "react";
import { Loader2, Save, Star } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Employee } from "@/lib/hr-types";
import { supabase } from "@/integrations/supabase/client";

type DirectorRating = {
  id: string;
  review_month: string;
  employee_id: string;
  employee_name: string;
  director_rating: number;
  notes: string | null;
  updated_at: string;
};

export function DirectorRatingsPanel({
  employees,
  selectedMonth,
}: {
  employees: Employee[];
  selectedMonth: string;
}) {
  const [ratings, setRatings] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sortedEmployees = useMemo(
    () => [...employees].sort((a, b) => a.name.localeCompare(b.name)),
    [employees],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;
        if (!token) throw new Error("Your session has expired. Please sign in again.");
        const response = await fetch(
          `/api/director-ratings?month=${encodeURIComponent(selectedMonth)}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error(payload?.message ?? "Could not load Director Ratings.");
        if (cancelled) return;
        const nextRatings: Record<string, string> = {};
        const nextNotes: Record<string, string> = {};
        for (const rating of (payload?.ratings ?? []) as DirectorRating[]) {
          nextRatings[rating.employee_id] = String(rating.director_rating);
          nextNotes[rating.employee_id] = rating.notes ?? "";
        }
        setRatings(nextRatings);
        setNotes(nextNotes);
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error ? loadError.message : "Could not load Director Ratings.",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedMonth]);

  const saveRating = async (employee: Employee) => {
    const raw = ratings[employee.id]?.trim() ?? "";
    const value = Number(raw);
    if (!raw || !Number.isFinite(value) || value < 0 || value > 100) {
      toast.error("Enter a Director Rating from 0 to 100", { description: employee.name });
      return;
    }
    setSavingId(employee.id);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Your session has expired. Please sign in again.");
      const response = await fetch("/api/director-ratings", {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          reviewMonth: selectedMonth,
          employeeId: employee.id,
          employeeName: employee.name,
          directorRating: value,
          notes: notes[employee.id]?.trim() || null,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.message ?? "Could not save Director Rating.");
      toast.success("Director Rating saved", {
        description: `${employee.name} · ${selectedMonth}`,
      });
    } catch (saveError) {
      toast.error("Could not save Director Rating", {
        description: saveError instanceof Error ? saveError.message : "Unknown error",
      });
    } finally {
      setSavingId(null);
    }
  };

  return (
    <section className="panel mb-8 space-y-5 p-5">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-primary/40 bg-primary/10 text-primary">
          <Star className="h-5 w-5" />
        </span>
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-primary">
            Director Ratings
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Store the director’s monthly rating separately for each employee. These values are saved
            to Supabase and are not used in the current score calculation yet.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/70 bg-secondary/20 p-3">
        <div>
          <p className="text-xs font-medium text-foreground">Editing month</p>
          <p className="mt-1 text-xs text-muted-foreground">{selectedMonth}</p>
        </div>
        <p className="text-xs text-muted-foreground">Allowed range: 0–100</p>
      </div>

      {loading ? <p className="text-xs text-muted-foreground">Loading Director Ratings…</p> : null}
      {error ? <p className="text-xs text-danger">{error}</p> : null}
      {!loading && !error ? (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[760px] text-left text-xs">
            <thead className="bg-secondary/60 text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Employee</th>
                <th className="px-3 py-2 font-medium">Role</th>
                <th className="w-36 px-3 py-2 font-medium">Director Rating</th>
                <th className="px-3 py-2 font-medium">Notes</th>
                <th className="w-28 px-3 py-2 font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {sortedEmployees.map((employee) => (
                <tr key={employee.id} className="border-t border-border/70">
                  <td className="px-3 py-2 font-medium">{employee.name}</td>
                  <td className="px-3 py-2 text-muted-foreground">{employee.role}</td>
                  <td className="px-3 py-2">
                    <Input
                      type="number"
                      min="0"
                      max="100"
                      step="0.1"
                      value={ratings[employee.id] ?? ""}
                      onChange={(event) =>
                        setRatings((current) => ({ ...current, [employee.id]: event.target.value }))
                      }
                      placeholder="Not set"
                      aria-label={`Director Rating for ${employee.name}`}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      value={notes[employee.id] ?? ""}
                      onChange={(event) =>
                        setNotes((current) => ({ ...current, [employee.id]: event.target.value }))
                      }
                      placeholder="Optional note"
                      aria-label={`Notes for ${employee.name}`}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="gold"
                      disabled={savingId === employee.id}
                      onClick={() => void saveRating(employee)}
                    >
                      {savingId === employee.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Save className="h-3.5 w-3.5" />
                      )}
                      Save
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
