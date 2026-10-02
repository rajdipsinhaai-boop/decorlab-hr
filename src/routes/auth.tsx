import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { setRememberMe, supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import decorlabLogo from "@/assets/decorlab-logo.png";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in · Decorlab HR Performance" },
      {
        name: "description",
        content: "Secure sign-in for the Decorlab leadership HR performance dashboard.",
      },
      { property: "og:title", content: "Sign in · Decorlab HR Performance" },
      {
        property: "og:description",
        content: "Secure sign-in for the Decorlab leadership HR performance dashboard.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AuthPage,
});

function formatAuthError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Authentication failed";
  const normalized = message.toLowerCase();

  if (normalized.includes("invalid login credentials")) {
    return "The email or password is incorrect. Accounts are created by your administrator; contact them if you cannot sign in.";
  }
  if (normalized.includes("redirect") && normalized.includes("not allowed")) {
    return "The authentication redirect is not configured for this site. Contact the administrator so the production URL can be added in Supabase.";
  }

  return message;
}

function AuthPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/dashboard" });
    });
  }, [navigate]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const normalizedEmail = email.trim().toLowerCase();

    try {
      setRememberMe(remember);
      const { error } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      });
      if (error) throw error;
      navigate({ to: "/dashboard" });
    } catch (err) {
      toast.error(formatAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="panel w-full max-w-sm p-7">
        <div className="mb-6 text-center">
          <img
            src={decorlabLogo}
            alt="Decorlab logo"
            className="mx-auto mb-3 h-24 w-24 object-contain sm:h-28 sm:w-28"
          />
          <h1 className="text-xl font-semibold tracking-tight">
            Decor<span className="text-gold-gradient">lab</span> HR
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Sign in with the email your administrator registered for you.
          </p>
        </div>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="h-3.5 w-3.5 accent-primary"
            />
            Remember me on this device
          </label>
          <Button type="submit" variant="gold" className="w-full" disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Sign in
          </Button>
        </form>
      </div>
    </main>
  );
}
