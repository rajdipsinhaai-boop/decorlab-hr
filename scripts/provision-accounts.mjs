#!/usr/bin/env node
// Creates Supabase Auth accounts (email pre-confirmed, default password, must change it on first login)
// and the matching allowed_emails rows from a CSV. Dry run unless --apply is passed.
//
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... DEFAULT_EMPLOYEE_PASSWORD=... \
//     node scripts/provision-accounts.mjs people.csv [--apply] [--allow-demote]
//
// CSV header: email,name,employee_id,position,role      (role = admin | manager | employee)
// Existing Auth users are never touched (password kept); only their allowed_emails row is updated.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const apply = args.includes("--apply");
const allowDemote = args.includes("--allow-demote");
const ROLES = ["admin", "manager", "employee"];

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((v) => v.trim())) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((v) => v.trim())) rows.push(row);
  return rows;
}

const mask = (email) => email.replace(/^(.).*(@.*)$/, "$1***$2");

if (!file) fail("Pass the CSV path: node scripts/provision-accounts.mjs people.csv [--apply]");
const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const defaultPassword = process.env.DEFAULT_EMPLOYEE_PASSWORD;
if (!url || !serviceKey) fail("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
if (apply && (!defaultPassword || defaultPassword.length < 8))
  fail("Set DEFAULT_EMPLOYEE_PASSWORD (8+ characters) to use --apply.");

const [header, ...body] = parseCsv(readFileSync(file, "utf8"));
const cols = header.map((h) => h.trim().toLowerCase());
for (const need of ["email", "role"]) if (!cols.includes(need)) fail(`CSV is missing the "${need}" column.`);
const people = body.map((r) => Object.fromEntries(cols.map((c, i) => [c, (r[i] ?? "").trim()])));

const seen = new Set();
for (const p of people) {
  p.email = p.email.toLowerCase();
  p.role = p.role.toLowerCase();
  if (!p.email.includes("@")) fail(`Bad email: "${p.email}"`);
  // Placeholder rows: creating an account on a made-up address blocks the real one later.
  if (p.email.startsWith("todo")) fail(`${p.email} is still a placeholder - put the real address in the CSV or delete the row.`);
  if (!ROLES.includes(p.role)) fail(`Bad role "${p.role}" for ${mask(p.email)} (use ${ROLES.join(" | ")}).`);
  if (seen.has(p.email)) fail(`Duplicate email in CSV: ${mask(p.email)}`);
  seen.add(p.email);
}

const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

async function existingAuthEmails() {
  const found = new Set();
  for (let page = 1; ; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) fail(`Could not list Auth users: ${error.message}`);
    data.users.forEach((u) => u.email && found.add(u.email.toLowerCase()));
    if (data.users.length < 1000) return found;
  }
}

const { data: listRows, error: listError } = await supabase.from("allowed_emails").select("email, role");
if (listError) fail(`Could not read allowed_emails: ${listError.message}`);

// The position column arrived in a later migration; skip it rather than failing on an older schema.
const { error: positionError } = await supabase.from("allowed_emails").select("position").limit(1);
const hasPosition = !positionError;
if (!hasPosition)
  console.log("Note: allowed_emails has no position column (run 202610020001_allowed_emails_position.sql to store job titles).");
const currentRole = new Map(listRows.map((r) => [r.email.toLowerCase(), r.role]));
const authEmails = await existingAuthEmails();

console.log(`${apply ? "APPLY" : "DRY RUN"}: ${people.length} people from ${file}\n`);
const result = { created: 0, existing: 0, listed: 0, failed: 0, blocked: 0 };

for (const p of people) {
  const had = currentRole.get(p.email);
  const demote = had === "admin" && p.role !== "admin";
  if (demote && !allowDemote) {
    console.log(`BLOCKED  ${mask(p.email)}  would demote admin -> ${p.role} (use --allow-demote)`);
    result.blocked++;
    continue;
  }
  const needsAccount = !authEmails.has(p.email);
  console.log(
    `${needsAccount ? "CREATE  " : "EXISTS  "} ${mask(p.email)}  ${p.role}${p.position ? ` / ${p.position}` : ""}` +
      `${had && had !== p.role ? `  (role ${had} -> ${p.role})` : ""}`,
  );
  if (!apply) continue;

  const { error: upsertError } = await supabase.from("allowed_emails").upsert(
    {
      email: p.email,
      role: p.role,
      employee_id: p.employee_id || null,
      employee_name: p.name || null,
      ...(hasPosition ? { position: p.position || null } : {}),
    },
    { onConflict: "email" },
  );
  if (upsertError) {
    console.log(`  FAILED allowed_emails: ${upsertError.message}`);
    result.failed++;
    continue;
  }
  result.listed++;

  if (!needsAccount) { result.existing++; continue; }
  const { error: createError } = await supabase.auth.admin.createUser({
    email: p.email,
    password: defaultPassword,
    email_confirm: true,
    // app_metadata: only the service role can write it, so the person cannot clear the flag
    // themselves - /api/change-password clears it after the password is actually changed.
    app_metadata: { must_change_password: true },
  });
  if (createError) {
    console.log(`  FAILED account: ${createError.message}`);
    result.failed++;
  } else result.created++;
}

console.log(`\n${apply ? "Done" : "Dry run only, nothing written"}:`, JSON.stringify(result));
if (!apply) console.log("Re-run with --apply to write.");
