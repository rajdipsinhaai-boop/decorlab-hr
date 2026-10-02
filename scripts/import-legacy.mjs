// One-off: moves the July and August 2026 history out of the spreadsheet snapshots that used to be
// hardcoded into the app and into the database.
//
//   npm run import:legacy -- --dry-run   # show what would be written
//   npm run import:legacy                 # write it (reads .env, then .env.local which overrides it)
//
// Safe to re-run: existing scores are never overwritten (so a newer Claude audit always wins) and a
// month that already has attendance (e.g. a real biometric upload) is left untouched.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const SNAPSHOTS = ["src/data/fallback-dashboard.json", "src/data/august-dashboard.json"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const clean = (v) => (v ?? "").toString().replace(/\s+/g, " ").trim();
const num = (v) => {
  const n = parseFloat(clean(v).replace(/[%,]/g, ""));
  return Number.isFinite(n) ? n : null;
};
const round1 = (n) => Math.round(n * 10) / 10;

function monthKeyOf(label) {
  const m = /^([A-Za-z]+) (\d{4})$/.exec(clean(label));
  const i = m ? MONTHS.findIndex((n) => n.toLowerCase() === m[1].toLowerCase()) : -1;
  return i >= 0 ? `${m[2]}-${String(i + 1).padStart(2, "0")}` : null;
}

/** KRA tab: header row, one row per parameter, then a "<Name> — TOTAL" row. */
function parseKra(grid) {
  const headers = (grid[0] ?? []).map((h) => clean(h).toLowerCase());
  const col = (needle) => headers.findIndex((h) => h.includes(needle));
  const iName = col("employee name");
  const iParam = col("kra parameter");
  const iWeight = col("weight");
  const iRating = col("rating (1-5)");
  const out = {};
  for (const row of grid.slice(1)) {
    const raw = clean(row[iName]);
    if (!raw) continue;
    const isTotal = /[—-]\s*TOTAL/i.test(raw);
    const name = raw.replace(/\s*[—-]\s*TOTAL.*$/i, "").trim();
    const rec = (out[name] ??= { criteria: [], totals: {} });
    if (isTotal) {
      headers.forEach((h, i) => {
        if (h) rec.totals[h] = clean(row[i]);
      });
    } else {
      const param = clean(row[iParam]);
      if (param && param.toLowerCase() !== "overall score") {
        rec.criteria.push({ name: param, weight: num(row[iWeight]) ?? 0, rating: num(row[iRating]) ?? 0 });
      }
    }
  }
  return out;
}

const total = (rec, ...needles) => {
  for (const n of needles) {
    const key = Object.keys(rec?.totals ?? {}).find((k) => k.includes(n));
    if (key) return num(rec.totals[key]);
  }
  return null;
};

/** The sheet stores the manager rating as a fraction (0.225 = 22.5%). */
const managerPct = (rec) => {
  const v = total(rec, "manager rating");
  return v === null ? 0 : v <= 1 ? v * 100 : v;
};

function buildBreakdown(group, rec) {
  const seg = (label, weight, score) => ({
    label,
    weight,
    score: round1(score),
    contribution: round1((score * weight) / 100),
  });
  const mgr = managerPct(rec);
  if (group === "supervisor") {
    return [
      seg("Attendance (discipline-adjusted)", 30, total(rec, "attendance score (discipline", "attendance score") ?? 0),
      seg("DPR Combined", 50, total(rec, "dpr combined") ?? 0),
      seg("System Work Feedback", 20, mgr),
    ];
  }
  if (group === "designer") {
    const attendance = total(rec, "attendance score") ?? 0;
    const coordination = total(rec, "coordination score");
    // No coordination signal in the month: attendance and feedback carry 50% each.
    if (coordination === null) return [seg("Attendance", 50, attendance), seg("System Work Feedback", 50, mgr)];
    return [seg("Attendance", 25, attendance), seg("Coordination", 40, coordination), seg("System Work Feedback", 35, mgr)];
  }
  return [seg("Attendance", 60, total(rec, "attendance score") ?? 0), seg("System Work Feedback", 40, mgr)];
}

const ragOf = (s) => (s >= 75 ? "GREEN" : s >= 60 ? "YELLOW" : "RED");
const groupOf = (role) => (/supervisor/i.test(role) ? "supervisor" : /designer/i.test(role) ? "designer" : "ea");

function clock(v) {
  const m = /^(\d{1,2}):(\d{2})/.exec(clean(v));
  return m ? { text: `${m[1].padStart(2, "0")}:${m[2]}`, minutes: Number(m[1]) * 60 + Number(m[2]) } : null;
}

/**
 * Pure: turns one snapshot into rows for monthly_scores and attendance_records.
 * `employeeByCosec` maps a biometric id (D100) to the employee id.
 */
export function buildLegacy(snapshot, employeeByCosec = new Map()) {
  const r = snapshot.ranges;
  const label = clean(r["Monthly Summary!A2:B2"]?.[0]?.[1]);
  const monthKey = monthKeyOf(label);
  if (!monthKey) throw new Error(`Cannot read the review month from the snapshot (${label}).`);

  const kra = {
    supervisor: parseKra(r["Supervisor KRA!A3:Q400"] ?? []),
    designer: parseKra(r["Designer KRA!A3:Q400"] ?? []),
    ea: parseKra(r["EA KRA!A3:Q200"] ?? []),
  };

  const summary = r["Monthly Summary!A3:H200"] ?? [];
  const sHead = (summary[0] ?? []).map((h) => clean(h).toLowerCase());
  const si = (needle) => sHead.findIndex((h) => h.includes(needle));
  const scores = [];
  for (const row of summary.slice(1)) {
    const id = clean(row[si("employee id")]);
    const name = clean(row[si("employee name")]);
    if (!id || !/^DLB-/.test(id)) continue; // blank spacer rows and the company overview block
    const group = groupOf(clean(row[si("role")]));
    const rec = kra[group][name];
    const score = num(row[si("final kra")]);
    if (score === null) continue;
    const discipline = total(rec, "discipline %");
    scores.push({
      month_key: monthKey,
      employee_id: id,
      final_score: score,
      rag: clean(row[si("rag")]).toUpperCase() || ragOf(score),
      rank_in_role: num(row[si("rank (in role)")]),
      overall_rank: num(row[si("overall rank")]),
      is_top3: Boolean(clean(row[si("top 3")])),
      breakdown: buildBreakdown(group, rec),
      criteria: rec?.criteria ?? [],
      note: rec?.totals["coordination basis"] ?? "",
      details: {
        totals: rec?.totals ?? {},
        filing_discipline_pct: discipline === null ? null : Math.round(discipline * 1000) / 10,
      },
      source: "legacy-sheet",
    });
  }

  const att = r["Daily Attendance!A3:I5000"] ?? [];
  const aHead = (att[0] ?? []).map((h) => clean(h).toLowerCase());
  const ai = (needle) => aHead.findIndex((h) => h.includes(needle));
  const attendance = [];
  for (const row of att.slice(1)) {
    const dmy = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(clean(row[ai("date")]));
    if (!dmy) continue;
    const workDate = `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
    const cosecId = clean(row[ai("employee id")]).toUpperCase();
    const inC = clock(row[ai("in time")]);
    const outC = clock(row[ai("out time")]);
    const hours = clock(row[ai("hours")]);
    const nextDay = new Date(Date.UTC(+dmy[3], +dmy[2] - 1, +dmy[1] + 1)).toISOString().slice(0, 10);
    attendance.push({
      month_key: workDate.slice(0, 7),
      work_date: workDate,
      cosec_id: cosecId,
      employee_id: employeeByCosec.get(cosecId) ?? null,
      raw_name: clean(row[ai("employee name")]),
      shift: null,
      in_at: inC ? `${workDate}T${inC.text}:00` : null,
      out_at: outC ? `${outC && inC && outC.minutes < inC.minutes ? nextDay : workDate}T${outC.text}:00` : null,
      in2_at: null,
      out2_at: null,
      first_half: "",
      second_half: "",
      status: clean(row[ai("status")]) || "Unknown",
      late_in_min: null,
      early_out_min: null,
      work_min: hours ? hours.minutes : null,
      manual_entry: false,
      reason: null,
    });
  }
  return { label, monthKey, scores, attendance };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!dryRun && (!url || !key)) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.");
  if (!dryRun) console.log(`Writing to Supabase project: ${new URL(url).hostname.split(".")[0]}`);
  const { createClient } = await import("@supabase/supabase-js");
  // New-style keys (sb_secret_...) are opaque, not JWTs: they go in "apikey" only, never as a Bearer token.
  const opaqueKey = key?.startsWith("sb_secret_") || key?.startsWith("sb_publishable_");
  const sb = dryRun
    ? null
    : createClient(url, key, {
        auth: { persistSession: false },
        global: {
          fetch: (input, init = {}) => {
            const headers = new Headers(init.headers);
            if (opaqueKey && headers.get("Authorization") === `Bearer ${key}`) headers.delete("Authorization");
            headers.set("apikey", key);
            return fetch(input, { ...init, headers });
          },
        },
      });

  let employeeByCosec = new Map();
  if (sb) {
    const { data, error } = await sb.from("employees").select("id, cosec_id");
    if (error) throw new Error(`Run the attendance_pipeline migration first (${error.message}).`);
    employeeByCosec = new Map(data.filter((e) => e.cosec_id).map((e) => [e.cosec_id, e.id]));
  }

  for (const file of SNAPSHOTS) {
    const built = buildLegacy(JSON.parse(readFileSync(file, "utf8")), employeeByCosec);
    console.log(`${built.label}: ${built.scores.length} scores, ${built.attendance.length} attendance rows`);
    if (!sb) continue;

    const { error: scoreError } = await sb
      .from("monthly_scores")
      .upsert(built.scores, { onConflict: "month_key,employee_id", ignoreDuplicates: true });
    if (scoreError) throw new Error(scoreError.message);

    const { count, error: countError } = await sb
      .from("attendance_records")
      .select("id", { count: "exact", head: true })
      .eq("month_key", built.monthKey);
    if (countError) throw new Error(countError.message);
    if (count) {
      console.log(`  attendance for ${built.label} already exists (${count} rows): left untouched`);
      continue;
    }
    const { error: attError } = await sb.rpc("import_attendance_records", { p_upload_id: null, p_rows: built.attendance });
    if (attError) throw new Error(attError.message);
    console.log("  attendance imported");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
