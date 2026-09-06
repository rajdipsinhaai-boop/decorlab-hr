import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Save, Star } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  getDirectorRatingDetails,
  saveDirectorRatingDetail,
  type DirectorRatingDetail,
} from "@/lib/hr.functions";

export function DirectorRatingsPanel({ selectedMonth }: { selectedMonth: string }) {
  const loadDetails = useServerFn(getDirectorRatingDetails);
  const saveDetail = useServerFn(saveDirectorRatingDetail);
  const [details, setDetails] = useState<DirectorRatingDetail[]>([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [ratings, setRatings] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const employees = useMemo(() => {
    const byId = new Map<string, { id: string; name: string; role: string }>();
    for (const row of details) {
      if (!byId.has(row.employee_id)) {
        byId.set(row.employee_id, { id: row.employee_id, name: row.employee_name, role: row.role });
      }
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [details]);

  const selectedEmployee = employees.find((employee) => employee.id === selectedEmployeeId) ?? null;
  const selectedRows = useMemo(
    () =>
      details
        .filter((row) => row.employee_id === selectedEmployeeId)
        .sort((a, b) => a.kra_parameter.localeCompare(b.kra_parameter)),
    [details, selectedEmployeeId],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSelectedEmployeeId("");
    void (async () => {
      try {
        const rows = await loadDetails({ data: { month: selectedMonth } });
        if (cancelled) return;
        const nextRatings: Record<string, string> = {};
        const nextNotes: Record<string, string> = {};
        for (const row of rows) {
          nextRatings[row.id] = String(row.rating_1_to_5);
          nextNotes[row.id] = row.notes ?? "";
        }
        setDetails(rows);
        setRatings(nextRatings);
        setNotes(nextNotes);
        setSelectedEmployeeId(rows[0]?.employee_id ?? "");
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
  }, [loadDetails, selectedMonth]);

  const saveEmployeeRatings = async () => {
    if (!selectedEmployee || !selectedRows.length) return;
    const invalid = selectedRows.find((row) => {
      const value = Number(ratings[row.id]);
      return !Number.isFinite(value) || value < 0 || value > 5;
    });
    if (invalid) {
      toast.error("Enter a rating from 0 to 5 for every KRA point", {
        description: invalid.kra_parameter,
      });
      return;
    }

    setSaving(true);
    try {
      const savedRows: DirectorRatingDetail[] = [];
      for (const row of selectedRows) {
        const rating = Number(ratings[row.id]);
        const saved = await saveDetail({
          data: {
            reviewMonth: row.review_month,
            employeeId: row.employee_id,
            employeeName: row.employee_name,
            role: row.role,
            kraParameter: row.kra_parameter,
            weight: row.weight,
            rating1To5: rating,
            weightedScore: row.weight == null ? row.weighted_score : rating * row.weight,
            sourceTab: row.source_tab,
            notes: notes[row.id]?.trim() || null,
          },
        });
        savedRows.push(saved);
      }
      setDetails((current) => {
        const savedById = new Map(savedRows.map((row) => [row.id, row]));
        return current.map((row) => savedById.get(row.id) ?? row);
      });
      toast.success("Employee Director Ratings saved", {
        description: `${selectedEmployee.name} · ${selectedMonth}`,
      });
    } catch (saveError) {
      toast.error("Could not save employee ratings", {
        description: saveError instanceof Error ? saveError.message : "Unknown error",
      });
    } finally {
      setSaving(false);
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
            Select one employee to review and update all of their KRA point ratings. Ratings are
            stored in Supabase and are not used in the current score calculation yet.
          </p>
        </div>
      </div>

      <div className="grid gap-3 rounded-lg border border-border/70 bg-secondary/20 p-4 md:grid-cols-[1fr_2fr] md:items-end">
        <div>
          <p className="text-xs font-medium text-foreground">Selected month</p>
          <p className="mt-1 text-sm text-muted-foreground">{selectedMonth}</p>
        </div>
        <label className="space-y-1.5 text-xs text-muted-foreground">
          Employee
          <select
            value={selectedEmployeeId}
            onChange={(event) => setSelectedEmployeeId(event.target.value)}
            disabled={loading || !employees.length}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
          >
            {!employees.length ? <option value="">No employees available</option> : null}
            {employees.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.name} · {employee.role || "Employee"}
              </option>
            ))}
          </select>
        </label>
      </div>

      {loading ? <p className="text-xs text-muted-foreground">Loading employee ratings…</p> : null}
      {error ? <p className="text-xs text-danger">{error}</p> : null}
      {!loading && !error && !selectedRows.length ? (
        <p className="text-xs text-muted-foreground">
          No detailed ratings are available for this month.
        </p>
      ) : null}

      {!loading && !error && selectedEmployee && selectedRows.length ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/70 p-4">
            <div>
              <p className="text-base font-semibold text-foreground">{selectedEmployee.name}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {selectedEmployee.role || "Employee"} · {selectedRows.length} KRA points · Rating
                scale 0–5
              </p>
            </div>
            <Button
              type="button"
              variant="gold"
              disabled={saving}
              onClick={() => void saveEmployeeRatings()}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {saving ? "Saving…" : "Save employee ratings"}
            </Button>
          </div>

          <div className="space-y-3">
            {selectedRows.map((row, index) => (
              <div
                key={row.id}
                className="grid gap-3 rounded-lg border border-border/70 p-4 md:grid-cols-[2fr_120px_1fr] md:items-end"
              >
                <div>
                  <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
                    KRA point {index + 1}
                  </p>
                  <p className="mt-1 text-sm font-medium text-foreground">{row.kra_parameter}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Weight: {row.weight == null ? "—" : `${Math.round(row.weight * 100)}%`} ·
                    Weighted score preview:{" "}
                    {row.weight == null
                      ? "—"
                      : (Number(ratings[row.id] ?? row.rating_1_to_5) * row.weight).toFixed(2)}
                  </p>
                </div>
                <label className="space-y-1.5 text-xs text-muted-foreground">
                  Rating (0–5)
                  <Input
                    type="number"
                    min="0"
                    max="5"
                    step="0.1"
                    value={ratings[row.id] ?? ""}
                    onChange={(event) =>
                      setRatings((current) => ({ ...current, [row.id]: event.target.value }))
                    }
                  />
                </label>
                <label className="space-y-1.5 text-xs text-muted-foreground">
                  Note (optional)
                  <Input
                    value={notes[row.id] ?? ""}
                    onChange={(event) =>
                      setNotes((current) => ({ ...current, [row.id]: event.target.value }))
                    }
                    placeholder="Optional note"
                  />
                </label>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
