import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
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

  if (normalized.includes("email not confirmed")) {
    return "Your email is not confirmed yet. Confirm the email from Supabase, then sign in again. If it did not arrive, use Resend verification email.";
  }
  if (normalized.includes("rate limit") || normalized.includes("too many requests")) {
    return "Supabase has temporarily rate-limited email delivery. Stop retrying and contact the administrator, or try again later.";
  }
  if (normalized.includes("invalid login credentials")) {
    return "The email or password is incorrect. If this is a new account, confirm your email before signing in.";
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
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [busy, setBusy] = useState(false);
  const [resendBusy, setResendBusy] = useState(false);

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
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({
          email: normalizedEmail,
          password,
        });
        if (error) throw error;
        navigate({ to: "/dashboard" });
      } else {
        const { data, error } = await supabase.auth.signUp({
          email: normalizedEmail,
          password,
          options: { emailRedirectTo: `${window.location.origin}/dashboard` },
        });
        if (error) throw error;

        if (data.session) {
          toast.success("Account created", {
            description: "Your session is active. Opening the dashboard.",
          });
          navigate({ to: "/dashboard" });
          return;
        }

        toast.success("Account created", {
          description:
            "Confirm the email before signing in. If it does not arrive, return here and use Resend verification email.",
        });
        setMode("signin");
      }
    } catch (err) {
      toast.error(formatAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  const resendVerification = async () => {
    const targetEmail = email.trim().toLowerCase();
    if (!targetEmail) {
      toast.error("Enter the account email first.");
      return;
    }
    setResendBusy(true);
    try {
      const { error } = await supabase.auth.resend({
        type: "signup",
        email: targetEmail,
        options: { emailRedirectTo: `${window.location.origin}/dashboard` },
      });
      if (error) throw error;
      toast.success("Verification email sent", {
        description: `Check the inbox for ${targetEmail}.`,
      });
    } catch (err) {
      toast.error(formatAuthError(err));
    } finally {
      setResendBusy(false);
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
            Restricted to leadership. Access is limited to approved email addresses.
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
              minLength={6}
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <Button type="submit" variant="gold" className="w-full" disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {mode === "signin" ? "Sign in" : "Create account"}
          </Button>
        </form>
        {mode === "signin" ? (
          <button
            type="button"
            className="mt-3 w-full text-center text-xs text-muted-foreground underline-offset-4 hover:text-primary hover:underline disabled:opacity-50"
            disabled={resendBusy}
            onClick={resendVerification}
          >
            {resendBusy ? "Sending verification email…" : "Resend verification email"}
          </button>
        ) : (
          <p className="mt-3 text-center text-xs text-muted-foreground">
            Ask the administrator to add your email to the access list before creating an account.
            After signup, confirm the email before signing in. Supabase&apos;s shared email service
            can be rate-limited; if that appears, contact the administrator instead of retrying.
          </p>
        )}
        <button
          type="button"
          className="mt-4 w-full text-center text-xs text-muted-foreground underline-offset-4 hover:text-primary hover:underline"
          onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
        >
          {mode === "signin"
            ? "First time? Create your account"
            : "Already have an account? Sign in"}
        </button>
      </div>
    </main>
  );
}
