import { useState } from "react";
import { ChevronDown, Flag } from "lucide-react";
import type { Employee } from "@/lib/hr-types";

function gradeTone(grade: string) {
  if (/excellent|good/i.test(grade)) return "bg-success/15 text-success border-success/30";
  if (/partial/i.test(grade)) return "bg-warning/15 text-warning border-warning/30";
  if (/poor/i.test(grade)) return "bg-danger/15 text-danger border-danger/30";
  return "bg-secondary text-muted-foreground border-border";
}

function statusTone(status: string) {
  if (/done|complete/i.test(status)) return "bg-success/15 text-success border-success/30";
  if (/progress|pending/i.test(status)) return "bg-warning/15 text-warning border-warning/30";
  if (/delay|blocked/i.test(status)) return "bg-danger/15 text-danger border-danger/30";
  return "bg-secondary text-muted-foreground border-border";
}

export function ActivitySection({ employee, month }: { employee: Employee; month: string }) {
  const [open, setOpen] = useState(false);
  const isSupervisor = employee.roleGroup === "supervisor";
  const count = isSupervisor ? employee.dprActivity.length : employee.taskActivity.length;

  return (
    <section className="rounded-xl border border-border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/40"
        aria-expanded={open}
      >
        <span>
          <span className="block text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Activity this month
          </span>
          <span className="text-xs text-muted-foreground">
            {count
              ? `${count} ${isSupervisor ? "DPR entries" : "tasks"} logged for ${month}`
              : "No activity rows logged yet"}
          </span>
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-300 ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open ? (
        <div className="max-h-72 space-y-2 overflow-y-auto border-t border-border p-3">
          {!count ? (
            <p className="text-sm text-muted-foreground">Nothing logged for this period yet.</p>
          ) : isSupervisor ? (
            employee.dprActivity.map((row, i) => (
              <div key={`${row.date}-${i}`} className="rounded-lg bg-secondary/50 p-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium text-foreground">{row.date}</span>
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${gradeTone(row.grade)}`}>
                    {row.grade || "—"}
                  </span>
                  {row.blockers ? (
                    <span className="flex items-center gap-1 rounded-full border border-warning/30 bg-warning/15 px-2 py-0.5 text-[10px] font-semibold text-warning">
                      <Flag className="h-3 w-3" /> Blockers
                    </span>
                  ) : null}
                </div>
                {row.summary ? <p className="mt-1 text-xs text-muted-foreground">{row.summary}</p> : null}
              </div>
            ))
          ) : (
            employee.taskActivity.map((row, i) => (
              <div key={`${row.task}-${i}`} className="rounded-lg bg-secondary/50 p-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium text-foreground">{row.task || "Untitled task"}</span>
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${statusTone(row.status)}`}>
                    {row.status || "—"}
                  </span>
                  {Number(row.revisions) > 0 ? (
                    <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">
                      {row.revisions} revisions
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {row.assignedDate ? `Assigned ${row.assignedDate}` : "Assigned —"}
                  {row.doneDate ? ` · Done ${row.doneDate}` : ""}
                </p>
                {row.notes ? <p className="mt-1 text-xs text-muted-foreground">{row.notes}</p> : null}
              </div>
            ))
          )}
        </div>
      ) : null}
    </section>
  );
}