#!/usr/bin/env node
// Sets a NEW default password for accounts that have never signed in (and still have to change it).
// Anyone who has ever logged in is never touched. Dry run unless --apply is passed.
//
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... DEFAULT_EMPLOYEE_PASSWORD=... \
//     node scripts/reset-default-password.mjs [--apply]
//
// The accounts keep must_change_password = true, so each person still has to choose their own
// password at first sign-in.
import { createClient } from "@supabase/supabase-js";

const apply = process.argv.includes("--apply");
const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const password = process.env.DEFAULT_EMPLOYEE_PASSWORD;
if (!url || !serviceKey) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}
if (apply && (!password || password.length < 8)) {
  console.error("Set DEFAULT_EMPLOYEE_PASSWORD (8+ characters) to use --apply.");
  process.exit(1);
}
const mask = (email) => email.replace(/^(.).*(@.*)$/, "$1***$2");

const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

const users = [];
for (let page = 1; ; page++) {
  const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
  if (error) {
    console.error(`Could not list users: ${error.message}`);
    process.exit(1);
  }
  users.push(...data.users);
  if (data.users.length < 1000) break;
}

// never signed in AND still flagged to change the password: i.e. still on the default one
const targets = users.filter((u) => !u.last_sign_in_at && u.app_metadata?.must_change_password === true);
console.log(`${apply ? "APPLY" : "DRY RUN"}: ${targets.length} account(s) have never signed in\n`);

let done = 0;
let failed = 0;
for (const u of targets) {
  console.log(`${apply ? "RESET " : "WOULD RESET"} ${mask(u.email ?? "")}`);
  if (!apply) continue;
  const { error } = await supabase.auth.admin.updateUserById(u.id, {
    password,
    app_metadata: { ...u.app_metadata, must_change_password: true },
  });
  if (error) {
    console.log(`  FAILED: ${error.message}`);
    failed++;
  } else done++;
}
console.log(`\n${apply ? "Done" : "Dry run only, nothing written"}:`, JSON.stringify({ reset: done, failed }));
if (!apply) console.log("Re-run with --apply to write.");
