import { Fragment, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import type { DashboardData, MonthInfo } from "@/lib/hr-types";
import { AttendanceHeatmap } from "./AttendanceHeatmap";
import { fetchDashboard } from "./fetch-dashboard";

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/**
 * Look at any month's attendance on demand: the same per-person table shown after an upload,
 * read from the database, with each person's day-by-day calendar one click away.
 */
export function AttendanceViewer({ data }: { data: DashboardData }) {
  const months: MonthInfo[] = data.monthInfo.filter((m) => m.hasAttendance);
  const [month, setMonth] = useState(months.some((m) => m.month === data.month) ? data.month : (months[0]?.month ?? ""));
  const [open, setOpen] = useState<string | null>(null);

  // Same query key as the main dashboard, so the month you are already on costs nothing extra.
  const { data: view, isLoading, error } = useQuery({
    queryKey: ["hr-dashboard", month],
    queryFn: () => fetchDashboard(month),
    enabled: Boolean(month),
    staleTime: 60_000,
  });
  const rows = view?.viewerRole === "admin" ? view.data.employees.filter((e) => e.hasAttendance) : [];

  return (
    <section className="panel space-y-4 p-4 sm:p-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-primary" />
          <div>
            <h3 className="text-sm font-semibold">View attendance</h3>
            <p className="text-xs text-muted-foreground">
              Pick any month that has been uploaded. Click a person to see their days.
            </p>
          </div>
        </div>
        {months.length ? (
          <select
            value={month}
            onChange={(e) => {
              setMonth(e.target.value);
              setOpen(null);
            }}
            aria-label="Attendance month"
            className="h-9 rounded-md border border-border bg-background px-3 text-xs font-medium outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          >
            {months.map((m) => (
              <option key={m.month} value={m.month}>
                {m.month}
              </option>
            ))}
          </select>
        ) : null}
      </header>

      {!months.length ? (
        <p className="text-sm text-muted-foreground">No attendance has been uploaded yet.</p>
      ) : isLoading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading {month}…
        </p>
      ) : error ? (
        <p className="text-sm text-danger">{error instanceof Error ? error.message : "Could not load attendance."}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-xs">
            <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="py-1.5 pr-2 font-medium">Employee</th>
                <th className="px-2 font-medium">Present</th>
                <th className="px-2 font-medium">Half</th>
                <th className="px-2 font-medium">Absent</th>
                <th className="px-2 font-medium">Leave</th>
                <th className="px-2 font-medium">Avg hrs</th>
                <th className="px-2 font-medium">Punctuality</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => {
                const expanded = open === e.id;
                return (
                  <Fragment key={e.id}>
                    <tr
                      className="cursor-pointer border-t border-border/60 hover:bg-accent/40"
                      onClick={() => setOpen(expanded ? null : e.id)}
                    >
                      <td className="py-1.5 pr-2">
                        <span className="inline-flex items-center gap-1.5 font-medium">
                          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                          {e.name}
                        </span>
                        <span className="ml-5 block text-[10px] text-muted-foreground">{e.role}</span>
                      </td>
                      <td className="px-2 tabular-nums">{e.presentDays}</td>
                      <td className="px-2 tabular-nums">{e.halfDays}</td>
                      <td className="px-2 tabular-nums">{e.absentDays}</td>
                      <td className="px-2 tabular-nums">{e.leaveDays}</td>
                      <td className="px-2 tabular-nums">{fmt(e.avgHours)}</td>
                      <td className="px-2 tabular-nums">
                        {e.punctualityDeviation > 0 ? "+" : ""}
                        {e.punctualityDeviation} min
                      </td>
                    </tr>
                    {expanded ? (
                      <tr className="bg-secondary/20">
                        <td colSpan={7} className="space-y-3 p-3">
                          <AttendanceHeatmap days={e.days} />
                          <DayList days={e.days} />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          <p className="mt-3 text-[11px] text-muted-foreground">
            Present counts full days, half days and days with a missing punch. Punctuality is the average arrival
            against each role's start time ({data.scheduledStart}), positive = late. Late arrivals are fine when the full 8h30 duty is completed.
          </p>
        </div>
      )}
    </section>
  );
}

function DayList({ days }: { days: { date: string; day: string; status: string; inTime: string; outTime: string; hours: number }[] }) {
  return (
    <div className="max-h-64 overflow-y-auto rounded-md border border-border/60">
      <table className="w-full text-left text-[11px]">
        <thead className="sticky top-0 bg-card text-[10px] uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="px-2 py-1 font-medium">Date</th>
            <th className="px-2 font-medium">Day</th>
            <th className="px-2 font-medium">Status</th>
            <th className="px-2 font-medium">In</th>
            <th className="px-2 font-medium">Out</th>
            <th className="px-2 font-medium">Hours</th>
          </tr>
        </thead>
        <tbody>
          {days.map((d) => (
            <tr key={d.date} className="border-t border-border/40">
              <td className="px-2 py-1 tabular-nums">{d.date}</td>
              <td className="px-2">{d.day}</td>
              <td className="px-2">{d.status}</td>
              <td className="px-2 tabular-nums">{d.inTime || "—"}</td>
              <td className="px-2 tabular-nums">{d.outTime || "—"}</td>
              <td className="px-2 tabular-nums">{d.hours ? d.hours.toFixed(1) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
