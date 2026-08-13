import type { AttendanceDay } from "@/lib/hr-types";

function toneOf(status: string) {
  if (/week off|weekoff|off/i.test(status)) return "bg-muted text-muted-foreground";
  if (/absent/i.test(status)) return "bg-danger/80 text-danger-foreground";
  if (/incomplete/i.test(status)) return "bg-warning/80 text-warning-foreground";
  if (/present/i.test(status)) return "bg-success/80 text-success-foreground";
  return "bg-secondary text-muted-foreground";
}

export function AttendanceHeatmap({ days }: { days: AttendanceDay[] }) {
  if (!days.length) {
    return <p className="text-sm text-muted-foreground">No attendance rows for this period.</p>;
  }
  return (
    <div>
      <div className="grid grid-cols-7 gap-1.5 sm:grid-cols-10">
        {days.map((d, i) => (
          <div
            key={`${d.date}-${i}`}
            title={`${d.date} · ${d.status}${d.inTime ? ` · in ${d.inTime}` : ""}${d.outTime ? ` · out ${d.outTime}` : ""}`}
            className={`flex aspect-square items-center justify-center rounded-md text-[10px] font-medium transition-transform duration-200 hover:scale-110 ${toneOf(d.status)}`}
          >
            {d.date.split("/")[0]}
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <i className="h-2.5 w-2.5 rounded-sm bg-success/80" /> Present
        </span>
        <span className="flex items-center gap-1.5">
          <i className="h-2.5 w-2.5 rounded-sm bg-danger/80" /> Absent
        </span>
        <span className="flex items-center gap-1.5">
          <i className="h-2.5 w-2.5 rounded-sm bg-warning/80" /> Incomplete
        </span>
        <span className="flex items-center gap-1.5">
          <i className="h-2.5 w-2.5 rounded-sm bg-muted" /> Week off
        </span>
      </div>
    </div>
  );
}