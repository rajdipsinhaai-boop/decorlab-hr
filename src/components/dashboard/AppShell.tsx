import { useState, type ReactNode } from "react";
import {
  LayoutGrid,
  Users,
  CalendarClock,
  LineChart as LineChartIcon,
  ShieldCheck,
  LogOut,
  RefreshCw,
  Menu,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ViewerRole } from "@/lib/hr-types";
import decorlabLogo from "@/assets/decorlab-logo.png";

export interface NavItem {
  id: string;
  label: string;
  icon: ReactNode;
}

const ROLE_META: Record<ViewerRole, { label: string; tone: string }> = {
  admin: { label: "Administrator", tone: "border-primary/40 bg-primary/10 text-primary" },
  manager: {
    label: "Manager",
    tone: "border-[oklch(0.68_0.12_235)]/40 bg-[oklch(0.68_0.12_235)]/10 text-[oklch(0.68_0.12_235)]",
  },
  employee: { label: "Employee", tone: "border-success/40 bg-success/10 text-success" },
};

export function navForRole(role: ViewerRole): NavItem[] {
  if (role === "admin") {
    return [
      { id: "overview", label: "Overview", icon: <LayoutGrid className="h-4 w-4" /> },
      { id: "team", label: "Team", icon: <Users className="h-4 w-4" /> },
      { id: "attendance", label: "Attendance", icon: <CalendarClock className="h-4 w-4" /> },
      { id: "trends", label: "Trends", icon: <LineChartIcon className="h-4 w-4" /> },
      { id: "access", label: "Access & ratings", icon: <ShieldCheck className="h-4 w-4" /> },
    ];
  }
  if (role === "manager") {
    return [
      { id: "overview", label: "Overview", icon: <LayoutGrid className="h-4 w-4" /> },
      { id: "team", label: "Team roster", icon: <Users className="h-4 w-4" /> },
      {
        id: "attendance",
        label: "Attendance & uploads",
        icon: <CalendarClock className="h-4 w-4" />,
      },
    ];
  }
  return [{ id: "overview", label: "My report card", icon: <LayoutGrid className="h-4 w-4" /> }];
}

export function AppShell({
  role,
  title,
  subtitle,
  nav,
  activeNav,
  onNavChange,
  headerActions,
  children,
}: {
  role: ViewerRole;
  title: ReactNode;
  subtitle?: ReactNode;
  nav: NavItem[];
  activeNav: string;
  onNavChange: (id: string) => void;
  headerActions?: ReactNode;
  children: ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const meta = ROLE_META[role];

  return (
    <div className="mx-auto flex w-full max-w-[1400px] gap-0 px-0 lg:gap-6 lg:px-6">
      {/* Mobile top bar */}
      <div className="fixed inset-x-0 top-0 z-40 flex items-center justify-between border-b border-border bg-background/95 px-4 py-3 backdrop-blur lg:hidden">
        <div className="flex items-center gap-2">
          <img src={decorlabLogo} alt="Decorlab" className="h-8 w-8 object-contain" />
          <span className="text-sm font-semibold tracking-tight">Decorlab HR</span>
        </div>
        <button
          type="button"
          onClick={() => setMobileOpen((v) => !v)}
          className="rounded-md border border-border p-2 text-muted-foreground"
          aria-label="Toggle navigation"
        >
          {mobileOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
        </button>
      </div>

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-30 flex w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar/95 pt-16 backdrop-blur transition-transform duration-300 lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 lg:pt-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="hidden items-center gap-3 border-b border-sidebar-border px-5 py-5 lg:flex">
          <img src={decorlabLogo} alt="Decorlab" className="h-10 w-10 object-contain" />
          <div>
            <p className="text-sm font-semibold tracking-tight text-sidebar-foreground">Decorlab</p>
            <p className="text-[10px] uppercase tracking-[0.25em] text-primary">HR Console</p>
          </div>
        </div>

        <div className="px-4 pt-4">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-medium ${meta.tone}`}
          >
            <ShieldCheck className="h-3 w-3" /> {meta.label}
          </span>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          {nav.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                onNavChange(item.id);
                setMobileOpen(false);
                document
                  .getElementById(item.id)
                  ?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                activeNav === item.id
                  ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-[inset_2px_0_0_var(--primary)]"
                  : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
              }`}
            >
              <span className={activeNav === item.id ? "text-primary" : ""}>{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>

        <div className="border-t border-sidebar-border p-4 text-[11px] text-muted-foreground">
          Decorlab · est. 1993
        </div>
      </aside>

      {mobileOpen ? (
        <div
          className="fixed inset-0 z-20 bg-black/50 lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden
        />
      ) : null}

      {/* Main content */}
      <main className="min-w-0 flex-1 px-4 pb-16 pt-20 sm:px-6 lg:px-0 lg:pt-8">
        <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
            {subtitle ? <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p> : null}
          </div>
          {headerActions ? (
            <div className="flex flex-wrap items-center gap-2">{headerActions}</div>
          ) : null}
        </header>
        {children}
      </main>
    </div>
  );
}

export function IconButton({
  onClick,
  label,
  spinning,
  variant = "outline",
  children,
}: {
  onClick: () => void;
  label: string;
  spinning?: boolean;
  variant?: "outline" | "ghost";
  children: ReactNode;
}) {
  return (
    <Button variant={variant} size="icon" onClick={onClick} aria-label={label}>
      <span className={spinning ? "animate-spin" : ""}>{children}</span>
    </Button>
  );
}

export { RefreshCw, LogOut };
