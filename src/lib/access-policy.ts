/**
 * Controls whether authenticated users without an explicit access-list row can
 * enter the dashboard. Closed allow-list is the default; set ACCESS_OPEN_SIGNUPS=true
 * to let any confirmed Supabase account in as an "employee".
 */
export function isOpenSignupEnabled(): boolean {
  const configured = process.env["ACCESS_OPEN_SIGNUPS"]?.trim().toLowerCase();
  if (!configured) return false;
  return ["1", "true", "yes", "on"].includes(configured);
}
