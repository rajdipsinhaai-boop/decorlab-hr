import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Decorlab HR Performance" },
      {
        name: "description",
        content: "Private performance analytics for the Decorlab team — KRA scores, attendance and report cards.",
      },
      { property: "og:title", content: "Decorlab HR Performance" },
      {
        property: "og:description",
        content: "Private performance analytics for the Decorlab team — KRA scores, attendance and report cards.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Index,
});

function Index() {
  const navigate = useNavigate();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/dashboard" });
      else setChecked(true);
    });
  }, [navigate]);

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="panel max-w-md p-8 text-center">
        <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-primary/40 bg-secondary">
          <ShieldCheck className="h-5 w-5 text-primary" />
        </span>
        <p className="text-[11px] uppercase tracking-[0.3em] text-primary">Decorlab</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          HR Performance <span className="text-gold-gradient">Dashboard</span>
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Confidential leadership analytics. Sign in with an approved account to continue.
        </p>
        <Button
          variant="gold"
          className="mt-6 w-full"
          disabled={!checked}
          onClick={() => navigate({ to: "/auth" })}
        >
          Sign in <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </main>
  );
}
