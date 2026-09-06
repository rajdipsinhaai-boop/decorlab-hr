import { useMemo, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, LogOut, RefreshCw, Search } from "lucide-react";
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
import { AppShell, navForRole } from "@/components/dashboard/AppShell";

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

function useSectionRefs(_ids: string[]) {
  const refs = useRef<Record<string, HTMLDivElement | null>>({});
  const setRef = (id: string) => (el: HTMLDivElement | null) => {
    refs.current[id] = el;
  };
  return { setRef };
}

function DashboardPage() {
  const navigate = useNavigate();
  const [selectedMonth, setSelectedMonth] = useState("July 2026");
  const [activeNav, setActiveNav] = useState("overview");
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

  const role = view?.viewerRole ?? "employee";
  const nav = navForRole(role);
  const isManager = role === "manager";
  const isEmployee = role === "employee";
  const month = view ? (view.viewerRole === "admin" ? view.data.month : view.month) : "—";

  const title = isManager ? (
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
  );

  const headerActions = (
    <>
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
    </>
  );

  return (
    <div className="ambient-glow min-h-screen">
      <AppShell
        role={role}
        title={title}
        subtitle={`Review period: ${month} · live from the HR spreadsheet`}
        nav={nav}
        activeNav={activeNav}
        onNavChange={setActiveNav}
        headerActions={headerActions}
      >
        {error ? (
          <div className="panel mb-6 flex items-start gap-3 border-danger/50 p-5 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
            <div>
              <p className="font-medium">Could not load the dashboard</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {error instanceof Error ? error.message : "Unknown error"}
              </p>
            </div>
          </div>
        ) : null}

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
          <ManagerView
            month={view.month}
            months={view.months}
            roster={view.roster}
            own={view.own}
            onNavChange={setActiveNav}
          />
        ) : view?.viewerRole === "employee" ? (
          <EmployeeSelfView month={view.month} employee={view.employee} />
        ) : view ? (
          <LeadershipView data={view.data} selectedMonth={selectedMonth} />
        ) : null}
      </AppShell>
    </div>
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
  onNavChange,
}: {
  month: string;
  months: string[];
  roster: RosterEntry[];
  own: Employee | null;
  onNavChange: (id: string) => void;
}) {
  const [search, setSearch] = useState("");
  const { setRef } = useSectionRefs(["overview", "team", "attendance"]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return roster.filter(
      (r) => !q || r.name.toLowerCase().includes(q) || r.role.toLowerCase().includes(q),
    );
  }, [roster, search]);

  const grouped = useMemo(() => {
    return ROLE_ORDER.map((group) => ({
      group,
      people: filtered.filter((r) => r.roleGroup === group),
    })).filter((g) => g.people.length);
  }, [filtered]);

  return (
    <div className="space-y-10">
      <div ref={setRef("overview")} id="overview" className="space-y-6 scroll-mt-24">
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="panel-glass flex flex-col justify-between p-5 lg:col-span-1">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                Team size
              </p>
              <p className="mt-2 text-3xl font-semibold tabular-nums text-primary">
                {roster.length}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                People across your reporting lines
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                onNavChange("team");
                document
                  .getElementById("team")
                  ?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
              className="mt-4 self-start text-xs font-medium text-primary hover:underline"
            >
              View full roster →
            </button>
          </div>
          {own ? (
            <div className="panel space-y-3 p-5 lg:col-span-2">
              <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-primary">
                My report card
              </h2>
              <p className="text-xs text-muted-foreground">
                Your manager account can see the whole team roster and your own performance details.
              </p>
              <ManagerSelfCard employee={own} month={month} />
            </div>
          ) : null}
        </div>
      </div>

      <div ref={setRef("team")} id="team" className="scroll-mt-24">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Team roster
          </h2>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name or role…"
              className="h-9 w-56 rounded-md border border-border bg-background pl-8 pr-3 text-xs outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
          </div>
        </div>
        <div className="panel divide-y divide-border overflow-hidden">
          {grouped.map(({ group, people }) => (
            <div key={group}>
              <p className="bg-secondary/40 px-4 py-2 text-[11px] font-medium uppercase tracking-[0.2em] text-primary">
                {ROLE_LABEL[group] ?? group} · {people.length}
              </p>
              {people.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center gap-3 border-t border-border/60 px-4 py-3 transition-colors first:border-t-0 hover:bg-accent/40"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-primary/40 bg-secondary text-xs font-semibold text-primary">
                    {initialsOf(p.name)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{p.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{p.role}</span>
                  </span>
                </div>
              ))}
            </div>
          ))}
          {!grouped.length ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">No matches.</p>
          ) : null}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Team names and roles are visible to managers. Performance scores are limited to each
          manager's own report card and administrators.
        </p>
      </div>

      <div ref={setRef("attendance")} id="attendance" className="scroll-mt-24 space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Attendance &amp; uploads
        </h2>
        <section className="grid gap-4 lg:grid-cols-2">
          <UploadAttendanceCard months={months} />
          <UploadWhatsAppCard months={months} />
        </section>
      </div>

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

function LeadershipView({ data, selectedMonth }: { data: DashboardData; selectedMonth: string }) {
  const [selected, setSelected] = useState<Employee | null>(null);
  const [filter, setFilter] = useState<"ALL" | "RED" | "YELLOW" | "GREEN">("ALL");
  const { setRef } = useSectionRefs(["overview", "team", "attendance", "trends", "access"]);

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
      <div className="space-y-10">
        <div ref={setRef("overview")} id="overview" className="scroll-mt-24">
          <SummaryStrip employees={data.employees} />
        </div>

        <div ref={setRef("team")} id="team" className="scroll-mt-24">
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
        </div>

        <div ref={setRef("attendance")} id="attendance" className="scroll-mt-24 space-y-6">
          <section className="grid gap-4 lg:grid-cols-2">
            <UploadAttendanceCard months={data.months} />
            <UploadWhatsAppCard months={data.months} />
          </section>
          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Attendance &amp; punctuality
            </h2>
            <AttendanceSection data={data} />
          </section>
        </div>

        <div ref={setRef("trends")} id="trends" className="scroll-mt-24">
          <TrendSection data={data} />
        </div>

        <div ref={setRef("access")} id="access" className="scroll-mt-24 space-y-6">
          <AdminAccessPanel />
          <DirectorRatingsPanel selectedMonth={selectedMonth} />
        </div>

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
