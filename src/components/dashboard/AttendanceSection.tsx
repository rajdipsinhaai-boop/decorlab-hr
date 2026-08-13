import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DashboardData } from "@/lib/hr-types";

const axisTick = { fill: "var(--muted-foreground)", fontSize: 11 };
const tooltipStyle = {
  background: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: 10,
  color: "var(--popover-foreground)",
  fontSize: 12,
};

export function AttendanceSection({ data }: { data: DashboardData }) {
  const rows = data.employees.map((e) => ({
    name: e.name.split(" ")[0] ?? e.name,
    fullName: e.name,
    deviation: e.punctualityDeviation,
    hours: e.avgHours,
  }));

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="panel p-4 sm:p-5">
        <header className="mb-3">
          <h3 className="text-sm font-semibold">Punctuality deviation</h3>
          <p className="text-xs text-muted-foreground">
            Average in-time vs. scheduled {data.scheduledStart} (minutes; positive = late)
          </p>
        </header>
        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 8, left: -12 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="name" tick={axisTick} interval={0} angle={-35} textAnchor="end" height={62} />
              <YAxis tick={axisTick} />
              <ReferenceLine y={0} stroke="var(--primary)" />
              <Tooltip
                cursor={{ fill: "var(--accent)" }}
                contentStyle={tooltipStyle}
                formatter={(v: number) => [`${v} min`, "Deviation"]}
              />
              <Bar dataKey="deviation" radius={[6, 6, 0, 0]}>
                {rows.map((r) => (
                  <Cell
                    key={r.fullName}
                    fill={r.deviation > 30 ? "var(--danger)" : r.deviation > 0 ? "var(--warning)" : "var(--success)"}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="panel p-4 sm:p-5">
        <header className="mb-3">
          <h3 className="text-sm font-semibold">Average hours worked</h3>
          <p className="text-xs text-muted-foreground">Target {data.targetHours}h per working day</p>
        </header>
        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 8, left: -12 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="name" tick={axisTick} interval={0} angle={-35} textAnchor="end" height={62} />
              <YAxis tick={axisTick} />
              <ReferenceLine
                y={data.targetHours}
                stroke="var(--primary)"
                strokeDasharray="4 4"
                label={{ value: "Target", fill: "var(--primary)", fontSize: 10, position: "right" }}
              />
              <Legend wrapperStyle={{ fontSize: 11, color: "var(--muted-foreground)" }} />
              <Tooltip
                cursor={{ fill: "var(--accent)" }}
                contentStyle={tooltipStyle}
                formatter={(v: number) => [`${v} h`, "Avg hours"]}
              />
              <Bar name="Avg hours / day" dataKey="hours" radius={[6, 6, 0, 0]}>
                {rows.map((r) => (
                  <Cell
                    key={r.fullName}
                    fill={r.hours >= data.targetHours ? "var(--success)" : "var(--chart-1)"}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>
    </div>
  );
}