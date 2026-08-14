import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, LogOut, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getDashboard } from "@/lib/hr.functions";
import type { Employee } from "@/lib/hr-types";
import { SummaryStrip } from "@/components/dashboard/SummaryStrip";
import { EmployeeCard } from "@/components/dashboard/EmployeeCard";
import { EmployeeDetail } from "@/components/dashboard/EmployeeDetail";
import { AttendanceSection } from "@/components/dashboard/AttendanceSection";
import { TrendSection } from "@/components/dashboard/TrendSection";
import { CreateReportButton } from "@/components/dashboard/CreateReportButton";
import { UploadAttendanceCard } from "@/components/dashboard/UploadAttendanceCard";
import { UploadWhatsAppCard } from "@/components/dashboard/UploadWhatsAppCard";
import { AskTeamChat } from "@/components/dashboard/AskTeamChat";
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
        content: "Live KRA scores, RAG status, attendance and punctuality analytics for the Decorlab team.",
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
  const fetchDashboard = useServerFn(getDashboard);
  const [selected, setSelected] = useState<Employee | null>(null);
  const [filter, setFilter] = useState<"ALL" | "RED" | "YELLOW" | "GREEN">("ALL");

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["hr-dashboard"],
    queryFn: () => fetchDashboard(),
    staleTime: 60_000,
  });

  const employees = useMemo(() => {
    const list = data?.employees ?? [];
    return [...list]
      .filter((e) => filter === "ALL" || e.rag === filter)
      .sort(
        (a, b) =>
          ROLE_ORDER.indexOf(a.roleGroup) - ROLE_ORDER.indexOf(b.roleGroup) || b.score - a.score,
      );
  }, [data, filter]);

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth" });
  };

  return (
    <main className="mx-auto w-full max-w-7xl px-4 pb-16 pt-6 sm:px-6 lg:px-8">
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3 sm:gap-4">
          <img
            src={decorlabLogo}
            alt="Decorlab logo"
            className="h-12 w-12 shrink-0 rounded-xl border border-primary/30 bg-secondary object-contain p-1.5 sm:h-14 sm:w-14"
          />
          <div>
            <p className="text-[11px] uppercase tracking-[0.3em] text-primary">Decorlab</p>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              HR Performance <span className="text-gold-gradient">Dashboard</span>
            </h1>
            <p className="mt-1 text-xs text-muted-foreground">
              Review period: {data?.month ?? "—"} · live from the HR spreadsheet
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
          <CreateReportButton month={data?.month ?? ""} />
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
      ) : data ? (
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
                    {f === "ALL" ? "All" : f === "GREEN" ? "Green ≥75%" : f === "YELLOW" ? "Yellow 60-75%" : "Red <60%"}
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
              <p className="py-8 text-center text-sm text-muted-foreground">No employees in this bucket.</p>
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
      ) : null}

      <EmployeeDetail
        employee={selected}
        month={data?.month ?? ""}
        onOpenChange={(open) => !open && setSelected(null)}
      />

      <AskTeamChat />
    </main>
  );
}