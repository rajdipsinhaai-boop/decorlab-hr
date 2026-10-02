import { createFileRoute } from "@tanstack/react-router";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const MIN_LENGTH = 8;

/**
 * Sets the signed-in person's own password and clears the first-login flag.
 *
 * The flag lives in app_metadata, which only the service role can write, so the one server path that
 * can clear it is this handler - and it only does so after the password has actually been changed.
 * (user_metadata is self-writable: a flag kept there could be cleared from the browser console
 * without ever setting a password.)
 *
 * Supabase Auth (GoTrue) does the hashing and the comparison: it stores a bcrypt hash, never the
 * password, and sign-in compares against that hash. This app never sees, stores or logs either one.
 */
export const Route = createFileRoute("/api/change-password")({
  server: {
    middleware: [requireSupabaseAuth as never],
    handlers: {
      POST: async ({ request, context }) => {
        const { userId } = context as unknown as { userId: string };
        const body = (await request.json().catch(() => null)) as { password?: unknown } | null;
        const password = typeof body?.password === "string" ? body.password : "";
        if (password.length < MIN_LENGTH)
          return Response.json({ error: `Use at least ${MIN_LENGTH} characters.` }, { status: 400 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
          password,
          app_metadata: { must_change_password: false },
        });
        // Supabase rejects reusing the current password, which is what keeps the default from standing.
        if (error) return Response.json({ error: error.message }, { status: 400 });
        return Response.json({ ok: true });
      },
    },
  },
});
