import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    // Accounts created with a default password must choose their own first.
    if (data.user.app_metadata?.["must_change_password"] && location.pathname !== "/change-password")
      throw redirect({ to: "/change-password" });
    return { user: data.user };
  },
  component: () => <Outlet />,
});