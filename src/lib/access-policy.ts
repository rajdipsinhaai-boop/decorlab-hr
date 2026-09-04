/**
 * Controls whether authenticated users without an explicit access-list row can
 * enter the dashboard. Open signup is the default so a confirmed Supabase
 * account can sign in; set ACCESS_OPEN_SIGNUPS=false to restore a closed allow-list.
 */
export function isOpenSignupEnabled(): boolean {
  const configured = process.env.ACCESS_OPEN_SIGNUPS?.trim().toLowerCase();
  if (!configured) return true;
  return ["1", "true", "yes", "on"].includes(configured);
}
