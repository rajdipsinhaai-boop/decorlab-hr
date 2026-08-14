import {
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScoreRing } from "./ScoreRing";
import { AttendanceHeatmap } from "./AttendanceHeatmap";
import { initialsOf, ragLabel, type Employee } from "@/lib/hr-types";

const SEGMENT_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-4)"];

export function EmployeeDetail({
  employee,
  month,
  onOpenChange,
}: {
  employee: Employee | null;
  month: string;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={Boolean(employee)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto border-border bg-card">
        {employee ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-3 text-left">
                <span className="flex h-11 w-11 items-center justify-center rounded-full border border-primary/40 bg-secondary text-sm font-semibold text-primary">
                  {initialsOf(employee.name)}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-lg font-semibold">{employee.name}</span>
                  <span className="block text-xs font-normal text-muted-foreground">
                    {employee.role} · {month}
                  </span>
                </span>
              </DialogTitle>
            </DialogHeader>

            <div className="flex flex-wrap items-center gap-5">
              <ScoreRing score={employee.score} rag={employee.rag} />
              <div className="min-w-[180px] flex-1 space-y-1 text-sm">
                <p className="font-medium">
                  {ragLabel(employee.rag)} — {employee.score}%
                </p>
                <p className="text-xs text-muted-foreground">
                  Rank in role {employee.rankInRole ?? "—"} · Overall {employee.overallRank ?? "—"}
                </p>
                <p className="text-xs text-muted-foreground">
                  Avg {employee.avgHours}h/day · punctuality {employee.punctualityDeviation >= 0 ? "+" : ""}
                  {employee.punctualityDeviation} min
                </p>
                {employee.note ? <p className="text-xs text-muted-foreground">{employee.note}</p> : null}
              </div>
            </div>

            <section className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Weighted score breakdown
              </h4>
              <div className="flex h-9 w-full overflow-hidden rounded-lg border border-border">
                {employee.breakdown.map((seg, i) => (
                  <div
                    key={seg.label}
                    title={`${seg.label}: ${seg.score}% × ${seg.weight}% = ${seg.contribution}`}
                    className="flex items-center justify-center text-[10px] font-semibold text-primary-foreground transition-all duration-500"
                    style={{
                      width: `${seg.weight}%`,
                      backgroundColor: SEGMENT_COLORS[i % SEGMENT_COLORS.length],
                    }}
                  >
                    {seg.weight}%
                  </div>
                ))}
              </div>
              <ul className="grid gap-1.5 sm:grid-cols-3">
                {employee.breakdown.map((seg, i) => (
                  <li key={seg.label} className="flex items-start gap-2 text-xs">
                    <i
                      className="mt-1 h-2.5 w-2.5 shrink-0 rounded-sm"
                      style={{ backgroundColor: SEGMENT_COLORS[i % SEGMENT_COLORS.length] }}
                    />
                    <span>
                      <span className="block text-foreground">{seg.label}</span>
                      <span className="text-muted-foreground">
                        {seg.score}% × {seg.weight}% → {seg.contribution} pts
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>

            {employee.criteria.length ? (
              <section className="space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Rated criteria (1-5)
                </h4>
                 <div className="h-72 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                      <RadarChart data={employee.criteria} outerRadius="72%">
                        <PolarGrid stroke="var(--border)" />
                        <PolarAngleAxis
                          dataKey="name"
                          tick={{ fill: "var(--muted-foreground)", fontSize: 9 }}
                        />
                        <Radar
                          dataKey="rating"
                          stroke="var(--primary)"
                          fill="var(--primary)"
                          fillOpacity={0.35}
                        />
                        <Tooltip
                          contentStyle={{
                            background: "var(--popover)",
                            border: "1px solid var(--border)",
                            borderRadius: 10,
                            color: "var(--popover-foreground)",
                            fontSize: 12,
                          }}
                        />
                      </RadarChart>
                  </ResponsiveContainer>
                </div>
              </section>
            ) : null}

            <section className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Attendance calendar
              </h4>
              <AttendanceHeatmap days={employee.days} />
            </section>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}