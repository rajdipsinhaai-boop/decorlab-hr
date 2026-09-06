import { useEffect, useMemo, useState } from "react";
import { Loader2, Save, Star } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type RatingDetail = {
  id: string;
  review_month: string;
  employee_id: string;
  employee_name: string;
  role: string;
  kra_parameter: string;
  weight: number | null;
  rating_1_to_5: number;
  weighted_score: number | null;
  source_tab: string;
  notes: string | null;
  updated_at: string;
};

export function DirectorRatingsPanel({ selectedMonth }: { selectedMonth: string }) {
  const [details, setDetails] = useState<RatingDetail[]>([]);
  const [ratings, setRatings] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sortedDetails = useMemo(
    () =>
      [...details].sort(
        (a, b) =>
          a.employee_name.localeCompare(b.employee_name) ||
          a.kra_parameter.localeCompare(b.kra_parameter),
      ),
    [details],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const response = await fetch(
          `/api/director-rating-details?month=${encodeURIComponent(selectedMonth)}`,
        );
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error(payload?.message ?? "Could not load Director Ratings.");
        if (cancelled) return;
        const rows = (payload?.ratings ?? []) as RatingDetail[];
        const nextRatings: Record<string, string> = {};
        const nextNotes: Record<string, string> = {};
        for (const row of rows) {
          nextRatings[row.id] = String(row.rating_1_to_5);
          nextNotes[row.id] = row.notes ?? "";
        }
        setDetails(rows);
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

  const saveRating = async (row: RatingDetail) => {
    const raw = ratings[row.id]?.trim() ?? "";
    const value = Number(raw);
    if (!raw || !Number.isFinite(value) || value < 0 || value > 5) {
      toast.error("Enter a rating from 0 to 5", {
        description: `${row.employee_name} · ${row.kra_parameter}`,
      });
      return;
    }
    setSavingId(row.id);
    try {
      const response = await fetch("/api/director-rating-details", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reviewMonth: row.review_month,
          employeeId: row.employee_id,
          employeeName: row.employee_name,
          role: row.role,
          kraParameter: row.kra_parameter,
          weight: row.weight,
          rating1To5: value,
          weightedScore: row.weight == null ? row.weighted_score : value * row.weight,
          sourceTab: row.source_tab,
          notes: notes[row.id]?.trim() || null,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.message ?? "Could not save Director Rating.");
      const saved = payload?.rating as RatingDetail;
      setDetails((current) => current.map((item) => (item.id === row.id ? saved : item)));
      toast.success("Director Rating saved", {
        description: `${row.employee_name} · ${row.kra_parameter}`,
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
            Director Ratings by KRA Area
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            These are the detailed 0–5 ratings entered in the KRA sheets for each employee and
            scoring area. They are stored in Supabase and are not used in the current score
            calculation yet.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/70 bg-secondary/20 p-3">
        <div>
          <p className="text-xs font-medium text-foreground">Editing month</p>
          <p className="mt-1 text-xs text-muted-foreground">{selectedMonth}</p>
        </div>
        <p className="text-xs text-muted-foreground">
          Rating scale: 0–5 · source values imported from the KRA sheets
        </p>
      </div>

      {loading ? <p className="text-xs text-muted-foreground">Loading Director Ratings…</p> : null}
      {error ? <p className="text-xs text-danger">{error}</p> : null}
      {!loading && !error && !sortedDetails.length ? (
        <p className="text-xs text-muted-foreground">
          No detailed ratings are available for this month.
        </p>
      ) : null}
      {!loading && !error && sortedDetails.length ? (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[1080px] text-left text-xs">
            <thead className="bg-secondary/60 text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Employee</th>
                <th className="px-3 py-2 font-medium">Role</th>
                <th className="px-3 py-2 font-medium">KRA area</th>
                <th className="w-24 px-3 py-2 font-medium">Weight</th>
                <th className="w-32 px-3 py-2 font-medium">Rating 0–5</th>
                <th className="w-32 px-3 py-2 font-medium">Weighted score</th>
                <th className="w-56 px-3 py-2 font-medium">Notes</th>
                <th className="w-28 px-3 py-2 font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {sortedDetails.map((row) => (
                <tr key={row.id} className="border-t border-border/70">
                  <td className="px-3 py-2 font-medium">{row.employee_name}</td>
                  <td className="px-3 py-2 text-muted-foreground">{row.role || "—"}</td>
                  <td className="px-3 py-2">{row.kra_parameter}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {row.weight == null ? "—" : `${Math.round(row.weight * 100)}%`}
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      type="number"
                      min="0"
                      max="5"
                      step="0.1"
                      value={ratings[row.id] ?? ""}
                      onChange={(event) =>
                        setRatings((current) => ({ ...current, [row.id]: event.target.value }))
                      }
                      aria-label={`Rating for ${row.employee_name} ${row.kra_parameter}`}
                    />
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {row.weighted_score == null ? "—" : row.weighted_score}
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      value={notes[row.id] ?? ""}
                      onChange={(event) =>
                        setNotes((current) => ({ ...current, [row.id]: event.target.value }))
                      }
                      placeholder="Optional note"
                      aria-label={`Notes for ${row.employee_name} ${row.kra_parameter}`}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="gold"
                      disabled={savingId === row.id}
                      onClick={() => void saveRating(row)}
                    >
                      {savingId === row.id ? (
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
