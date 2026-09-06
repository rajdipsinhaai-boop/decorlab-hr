import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, LogOut, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { DashboardView } from "@/lib/hr-types";
import { initialsOf, type DashboardData, type Employee, type RosterEntry } from "@/lib/hr-types";
import { SummaryStrip } from "@/components/dashboard/SummaryStrip";
import { EmployeeCard } from "@/components/dashboard/EmployeeCard";
import { EmployeeDetail } from "@/components/dashboard/EmployeeDetail";
import { AttendanceSection } from "@/components/dashboard/AttendanceSection";
import { TrendSection } from "@/components/dashboard/TrendSection";
import { CreateReportButton } from "@/components/dashboard/CreateReportButton";
import { UploadAttendanceCard } from "@/components/dashboard/UploadAttendanceCard";
import { UploadWhatsAppCard } from "@/components/dashboard/UploadWhatsAppCard";
import { AskTeamChat } from "@/components/dashboard/AskTeamChat";
import { AdminAccessPanel } from "@/components/dashboard/AdminAccessPanel";
import { DirectorRatingsPanel } from "@/components/dashboard/DirectorRatingsPanel";
import decorlabLogo from "@/assets/decorlab-logo.png";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Decorlab HR Performance Dashboard" },
      {
        name: "description",
        content:
          "Live KRA scores, RAG status, attendance and punctuality analytics for the Decorlab team.",
      },
      { property: "og:title", content: "Decorlab HR Performance Dashboard" },
      {
        property: "og:description",
        content:
          "Live KRA scores, RAG status, attendance and punctuality analytics for the Decorlab team.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: DashboardPage,
});

const ROLE_ORDER = ["supervisor", "designer", "ea"] as const;

function DashboardPage() {
  const navigate = useNavigate();
  const [selectedMonth, setSelectedMonth] = useState("July 2026");
  const {
    data: view,
    isLoading,
    error,
    refetch,
    isFetching,
  } = useQuery<DashboardView>({
    queryKey: ["hr-dashboard", selectedMonth],
    queryFn: async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Your session has expired. Please sign in again.");
      const response = await fetch(`/api/dashboard?month=${encodeURIComponent(selectedMonth)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.message ?? payload?.error ?? "Could not load the dashboard.");
      }
      return payload as DashboardView;
    },
    staleTime: 60_000,
  });

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth" });
  };

  const isManager = view?.viewerRole === "manager";
  const isEmployee = view?.viewerRole === "employee";
  const month = view ? (view.viewerRole === "admin" ? view.data.month : view.month) : "—";

  return (
    <main className="mx-auto w-full max-w-7xl px-4 pb-16 pt-6 sm:px-6 lg:px-8">
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3 sm:gap-4">
          <img
            src={decorlabLogo}
            alt="Decorlab logo"
            className="h-16 w-16 shrink-0 object-contain sm:h-20 sm:w-20"
          />
          <div>
            <p className="text-[11px] uppercase tracking-[0.3em] text-primary">Decorlab</p>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              {isManager ? (
                <>
                  Manager <span className="text-gold-gradient">View</span>
                </>
              ) : isEmployee ? (
                <>
                  My <span className="text-gold-gradient">Report Card</span>
                </>
              ) : (
                <>
                  HR Performance <span className="text-gold-gradient">Dashboard</span>
                </>
              )}
            </h1>
            <p className="mt-1 text-xs text-muted-foreground">
              Review period: {month} · live from the HR spreadsheet
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => refetch()} aria-label="Refresh data">
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
          <Button variant="ghost" size="icon" onClick={signOut} aria-label="Sign out">
            <LogOut className="h-4 w-4" />
          </Button>
          {view?.viewerRole === "admin" ? (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="sr-only">Report month</span>
              <select
                value={selectedMonth}
                onChange={(event) => setSelectedMonth(event.target.value)}
                className="h-9 rounded-md border border-border bg-background px-3 text-xs font-medium text-foreground outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
              >
                {(view.data.months.length ? view.data.months : ["July 2026", "August 2026"]).map(
                  (option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ),
                )}
              </select>
            </label>
          ) : null}
          {view?.viewerRole === "admin" ? <CreateReportButton month={view.data.month} /> : null}
        </div>
      </header>

      {error ? (
        <div className="panel flex items-start gap-3 border-danger/50 p-5 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
          <div>
            <p className="font-medium">Could not load the dashboard</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {error instanceof Error ? error.message : "Unknown error"}
            </p>
          </div>
        </div>
      ) : null}

      {view?.viewerRole === "admin" ? <AdminAccessPanel /> : null}
      {view?.viewerRole === "admin" ? <DirectorRatingsPanel selectedMonth={selectedMonth} /> : null}

      {isLoading ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-xl" />
            ))}
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-40 rounded-xl" />
            ))}
          </div>
        </div>
      ) : view?.viewerRole === "manager" ? (
        <ManagerView month={view.month} months={view.months} roster={view.roster} own={view.own} />
      ) : view?.viewerRole === "employee" ? (
        <EmployeeSelfView month={view.month} employee={view.employee} />
      ) : view ? (
        <LeadershipView data={view.data} />
      ) : null}
    </main>
  );
}

const ROLE_LABEL: Record<string, string> = {
  supervisor: "Site supervisors",
  designer: "Interior designers",
  ea: "Executive assistant",
};

function ManagerView({
  month,
  months,
  roster,
  own,
}: {
  month: string;
  months: string[];
  roster: RosterEntry[];
  own: Employee | null;
}) {
  const grouped = useMemo(() => {
    return ROLE_ORDER.map((group) => ({
      group,
      people: roster.filter((r) => r.roleGroup === group),
    })).filter((g) => g.people.length);
  }, [roster]);

  return (
    <div className="space-y-8">
      <section className="grid gap-4 lg:grid-cols-2">
        <UploadAttendanceCard months={months} />
        <UploadWhatsAppCard months={months} />
      </section>

      {own ? (
        <section className="panel space-y-3 p-5">
          <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-primary">
            My report card
          </h2>
          <p className="text-xs text-muted-foreground">
            Your manager account can see the whole team roster and your own performance details.
          </p>
          <ManagerSelfCard employee={own} month={month} />
        </section>
      ) : null}

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Team
        </h2>
        <div className="space-y-5">
          {grouped.map(({ group, people }) => (
            <div key={group}>
              <p className="mb-2 text-xs uppercase tracking-[0.2em] text-primary">
                {ROLE_LABEL[group] ?? group}
              </p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {people.map((p) => (
                  <div
                    key={p.id}
                    className="panel flex items-center gap-3 p-4 transition-colors hover:border-primary/50"
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-primary/40 bg-secondary text-xs font-semibold text-primary">
                      {initialsOf(p.name)}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{p.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">{p.role}</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <p className="mt-4 text-xs text-muted-foreground">
          Team names and roles are visible to managers. Performance scores are limited to each
          manager’s own report card and administrators.
        </p>
      </section>

      <AskTeamChat />
    </div>
  );
}

function ManagerSelfCard({ employee, month }: { employee: Employee; month: string }) {
  const [selected, setSelected] = useState<Employee | null>(null);
  return (
    <>
      <EmployeeCard employee={employee} onOpen={() => setSelected(employee)} />
      <EmployeeDetail
        employee={selected}
        month={month}
        onOpenChange={(open) => !open && setSelected(null)}
      />
    </>
  );
}

function EmployeeSelfView({ employee, month }: { employee: Employee | null; month: string }) {
  const [selected, setSelected] = useState<Employee | null>(employee);
  if (!employee) {
    return (
      <div className="panel p-6 text-sm">
        Your account is approved, but it is not linked to an Employee Master record yet. Ask an
        administrator to add your Employee ID or exact name.
      </div>
    );
  }
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Personal report card
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Only your own performance, attendance, and report-card details are shown.
        </p>
      </div>
      <div className="max-w-md">
        <EmployeeCard employee={employee} onOpen={() => setSelected(employee)} />
      </div>
      <EmployeeDetail
        employee={selected}
        month={month}
        onOpenChange={(open) => !open && setSelected(null)}
      />
    </section>
  );
}

function LeadershipView({ data }: { data: DashboardData }) {
  const [selected, setSelected] = useState<Employee | null>(null);
  const [filter, setFilter] = useState<"ALL" | "RED" | "YELLOW" | "GREEN">("ALL");

  const employees = useMemo(() => {
    return [...data.employees]
      .filter((e) => filter === "ALL" || e.rag === filter)
      .sort(
        (a, b) =>
          ROLE_ORDER.indexOf(a.roleGroup) - ROLE_ORDER.indexOf(b.roleGroup) || b.score - a.score,
      );
  }, [data, filter]);

  return (
    <>
      <div className="space-y-8">
        <SummaryStrip employees={data.employees} />

        <section className="grid gap-4 lg:grid-cols-2">
          <UploadAttendanceCard months={data.months} />
          <UploadWhatsAppCard months={data.months} />
        </section>

        <section>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Team
            </h2>
            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
              {(["ALL", "GREEN", "YELLOW", "RED"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                  className={`rounded-full border px-3 py-1 transition-colors ${
                    filter === f
                      ? "border-primary bg-primary/15 text-primary"
                      : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
                  }`}
                >
                  {f === "ALL"
                    ? "All"
                    : f === "GREEN"
                      ? "Green ≥75%"
                      : f === "YELLOW"
                        ? "Yellow 60-75%"
                        : "Red <60%"}
                </button>
              ))}
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {employees.map((e) => (
              <EmployeeCard key={e.id} employee={e} onOpen={() => setSelected(e)} />
            ))}
          </div>
          {!employees.length ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No employees in this bucket.
            </p>
          ) : null}
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Attendance &amp; punctuality
          </h2>
          <AttendanceSection data={data} />
        </section>

        <TrendSection data={data} />

        <footer className="panel flex flex-wrap items-center gap-4 p-4 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">RAG legend</span>
          <span className="flex items-center gap-1.5">
            <i className="h-2.5 w-2.5 rounded-full bg-danger" /> Red — below 60%
          </span>
          <span className="flex items-center gap-1.5">
            <i className="h-2.5 w-2.5 rounded-full bg-warning" /> Yellow — 60% to 75%
          </span>
          <span className="flex items-center gap-1.5">
            <i className="h-2.5 w-2.5 rounded-full bg-success" /> Green — 75% and above
          </span>
        </footer>
      </div>

      <EmployeeDetail
        employee={selected}
        month={data.month}
        onOpenChange={(open) => !open && setSelected(null)}
      />

      <AskTeamChat />
    </>
  );
}
