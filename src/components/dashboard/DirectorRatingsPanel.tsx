import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2, Lock, Save, Star } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  getDirectorRatingDetails,
  openRatingMonth,
  saveDirectorRatings,
  type DirectorRatingDetail,
} from "@/lib/hr.functions";

export function DirectorRatingsPanel({
  selectedMonth,
  locked = false,
}: {
  selectedMonth: string;
  /** A finalized month cannot be edited until an administrator reopens it. */
  locked?: boolean;
}) {
  const loadDetails = useServerFn(getDirectorRatingDetails);
  const openMonth = useServerFn(openRatingMonth);
  const saveBatch = useServerFn(saveDirectorRatings);
  const queryClient = useQueryClient();
  const [details, setDetails] = useState<DirectorRatingDetail[]>([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [ratings, setRatings] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async (cancelled: () => boolean = () => false) => {
    // Make sure every employee has a (blank) row for every KRA point, so the list is never empty.
    if (!locked) await openMonth({ data: { month: selectedMonth } });
    const rows = await loadDetails({ data: { month: selectedMonth } });
    if (cancelled()) return;
    const nextRatings: Record<string, string> = {};
    const nextNotes: Record<string, string> = {};
    for (const row of rows) {
      nextRatings[row.id] = row.rating_1_to_5 === null ? "" : String(row.rating_1_to_5);
      nextNotes[row.id] = row.notes ?? "";
    }
    setDetails(rows);
    setRatings(nextRatings);
    setNotes(nextNotes);
    setSelectedEmployeeId((current) => (rows.some((r) => r.employee_id === current) ? current : (rows[0]?.employee_id ?? "")));
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        await load(() => cancelled);
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Could not load Director Ratings.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMonth]);

  const employees = useMemo(() => {
    const byId = new Map<string, { id: string; name: string; role: string; rated: number; total: number }>();
    for (const row of details) {
      const e = byId.get(row.employee_id) ?? { id: row.employee_id, name: row.employee_name, role: row.role, rated: 0, total: 0 };
      e.total++;
      if ((ratings[row.id] ?? "") !== "") e.rated++;
      byId.set(row.employee_id, e);
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [details, ratings]);

  const selectedEmployee = employees.find((employee) => employee.id === selectedEmployeeId) ?? null;
  const selectedRows = useMemo(
    () => details.filter((row) => row.employee_id === selectedEmployeeId),
    [details, selectedEmployeeId],
  );
  const completeCount = employees.filter((e) => e.rated === e.total).length;

  const saveEmployeeRatings = async () => {
    if (!selectedEmployee || !selectedRows.length) return;
    const invalid = selectedRows.find((row) => {
      const raw = ratings[row.id] ?? "";
      if (raw === "") return false; // blank = not rated yet
      const value = Number(raw);
      return !Number.isFinite(value) || value < 0 || value > 5;
    });
    if (invalid) {
      toast.error("Ratings must be between 0 and 5 (or left blank)", { description: invalid.kra_parameter });
      return;
    }
    setSaving(true);
    try {
      await saveBatch({
        data: {
          month: selectedMonth,
          ratings: selectedRows.map((row) => ({
            id: row.id,
            rating: (ratings[row.id] ?? "") === "" ? null : Number(ratings[row.id]),
            notes: notes[row.id]?.trim() || null,
          })),
        },
      });
      const unrated = selectedRows.filter((row) => (ratings[row.id] ?? "") === "").length;
      toast.success(`Ratings saved for ${selectedEmployee.name}`, {
        description: unrated
          ? `${unrated} KRA point(s) still not rated: the score stays Pending until they are.`
          : "All KRA points rated. The score has been recalculated.",
      });
      void queryClient.invalidateQueries({ queryKey: ["hr-dashboard"] });
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
          <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-primary">Director Ratings</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Rate each KRA point from 0 to 5. A blank box means <strong>not rated yet</strong> (different from a real
            0). Saving recalculates the score straight away; it shows <em>Pending</em> until every KRA point for that
            person is rated.
          </p>
        </div>
      </div>

      {locked ? (
        <p className="flex items-center gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-xs">
          <Lock className="h-4 w-4 text-warning" /> {selectedMonth} is finalized. Reopen the month to change ratings.
        </p>
      ) : null}

      <div className="grid gap-3 rounded-lg border border-border/70 bg-secondary/20 p-4 md:grid-cols-[1fr_2fr] md:items-end">
        <div>
          <p className="text-xs font-medium text-foreground">Selected month</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {selectedMonth}
            {employees.length ? ` · ${completeCount} of ${employees.length} people fully rated` : ""}
          </p>
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
                {employee.rated === employee.total ? "✓ " : ""}
                {employee.name} · {employee.role || "Employee"} ({employee.rated}/{employee.total} rated)
              </option>
            ))}
          </select>
        </label>
      </div>

      {loading ? <p className="text-xs text-muted-foreground">Loading employee ratings…</p> : null}
      {error ? <p className="text-xs text-danger">{error}</p> : null}

      {!loading && !error && selectedEmployee && selectedRows.length ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/70 p-4">
            <div>
              <p className="flex items-center gap-2 text-base font-semibold text-foreground">
                {selectedEmployee.name}
                {selectedEmployee.rated === selectedEmployee.total ? <CheckCircle2 className="h-4 w-4 text-success" /> : null}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {selectedEmployee.role || "Employee"} · {selectedEmployee.rated} of {selectedRows.length} KRA points rated ·
                scale 0–5
              </p>
            </div>
            <Button type="button" variant="gold" disabled={saving || locked} onClick={() => void saveEmployeeRatings()}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {saving ? "Saving…" : "Save employee ratings"}
            </Button>
          </div>

          <div className="space-y-3">
            {selectedRows.map((row, index) => (
              <div key={row.id} className="grid gap-3 rounded-lg border border-border/70 p-4 md:grid-cols-[2fr_120px_1fr] md:items-end">
                <div>
                  <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">KRA point {index + 1}</p>
                  <p className="mt-1 text-sm font-medium text-foreground">{row.kra_parameter}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Weight: {row.weight == null ? "—" : `${Math.round(row.weight * 100)}%`}
                    {(ratings[row.id] ?? "") !== "" && row.weight != null
                      ? ` · Weighted score: ${(Number(ratings[row.id]) * row.weight).toFixed(2)}`
                      : ""}
                  </p>
                </div>
                <label className="space-y-1.5 text-xs text-muted-foreground">
                  Rating (0–5)
                  <Input
                    type="number"
                    min="0"
                    max="5"
                    step="0.1"
                    disabled={locked}
                    placeholder="Not rated"
                    value={ratings[row.id] ?? ""}
                    onChange={(event) => setRatings((current) => ({ ...current, [row.id]: event.target.value }))}
                  />
                </label>
                <label className="space-y-1.5 text-xs text-muted-foreground">
                  Note (optional)
                  <Input
                    disabled={locked}
                    value={notes[row.id] ?? ""}
                    onChange={(event) => setNotes((current) => ({ ...current, [row.id]: event.target.value }))}
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
