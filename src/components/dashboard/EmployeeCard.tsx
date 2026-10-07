import { ChevronRight, Crown } from "lucide-react";
import { ScoreRing } from "./ScoreRing";
import { fmtDay } from "@/lib/attendance/metrics";
import { initialsOf, ragLabel, type Employee } from "@/lib/hr-types";

export function EmployeeCard({ employee, onOpen }: { employee: Employee; onOpen: () => void }) {
  const ragTone =
    employee.rag === null
      ? "text-muted-foreground"
      : employee.rag === "GREEN"
        ? "text-success"
        : employee.rag === "YELLOW"
          ? "text-warning"
          : "text-danger";
  return (
    <button
      type="button"
      onClick={onOpen}
      className="panel group relative w-full overflow-hidden p-5 text-left transition-all duration-300 hover:-translate-y-1 hover:border-primary/60 hover:shadow-[var(--shadow-gold)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span
        aria-hidden
        className={`absolute inset-x-0 top-0 h-0.5 ${
          employee.rag === null
            ? "bg-border"
            : employee.rag === "GREEN"
              ? "bg-success"
              : employee.rag === "YELLOW"
                ? "bg-warning"
                : "bg-danger"
        }`}
      />
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-primary/40 bg-secondary text-sm font-semibold text-primary">
          {initialsOf(employee.name)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h3 className="truncate text-base font-semibold">{employee.name}</h3>
            {employee.probationEnds ? (
              <span
                title={`Probation ends ${fmtDay(employee.probationEnds)}`}
                className="shrink-0 rounded border border-warning/50 bg-warning/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warning"
              >
                Probation
              </span>
            ) : null}
            {employee.isTop3 ? <Crown className="h-3.5 w-3.5 shrink-0 text-primary" /> : null}
          </div>
          <p className="truncate text-xs text-muted-foreground">{employee.role}</p>
          <p className={`mt-2 text-sm font-medium ${ragTone}`}>
            {employee.score === null ? ragLabel(null) : `${ragLabel(employee.rag)} — ${employee.score}%`}
          </p>
        </div>
        <ScoreRing score={employee.score} rag={employee.rag} size={72} stroke={7} />
      </div>
      <div className="mt-4 flex items-center justify-between border-t border-border pt-3 text-xs text-muted-foreground">
        <span>
          {employee.hasAttendance
            ? `${employee.presentDays} present · ${employee.totalHours}h worked · ${employee.absentDays} absent`
            : "No attendance uploaded yet"}
        </span>
        <span className="inline-flex items-center gap-1 text-primary opacity-0 transition-opacity group-hover:opacity-100">
          Details <ChevronRight className="h-3.5 w-3.5" />
        </span>
      </div>
    </button>
  );
}
