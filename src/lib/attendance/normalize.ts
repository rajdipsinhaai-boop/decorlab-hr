import type { DayStatus } from "./types";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/** "September 2026" for a month key "2026-09". */
export function monthLabel(monthKey: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(monthKey);
  const name = m ? MONTHS[Number(m[2]) - 1] : undefined;
  return m && name ? `${name} ${m[1]}` : monthKey;
}

/** "2026-09" for "September 2026"; null when the label is not a month label. */
export function monthKeyOf(label: string): string | null {
  const m = /^([A-Za-z]+) (\d{4})$/.exec(label.trim());
  const idx = m ? MONTHS.findIndex((n) => n.toLowerCase() === m[1]!.toLowerCase()) : -1;
  return m && idx >= 0 ? `${m[2]}-${String(idx + 1).padStart(2, "0")}` : null;
}

/** Month keys from `from` to `to` inclusive, oldest first. */
export function monthKeysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.split("-").map(Number) as [number, number];
  const [ty, tm] = to.split("-").map(Number) as [number, number];
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    if (++m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

export function currentMonthKey(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Lowercase letters and single spaces only: "SUSHOVAN  Haldar." -> "sushovan haldar". */
export function normalizeName(raw: string): string {
  return raw
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Edit distance between two strings (iterative, O(n*m)). */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length]!;
}

/** "HH:MM" (or "H:MM") to minutes; null when it is not a clock value. */
export function hhmmToMinutes(v: string | null | undefined): number | null {
  const m = /^(\d{1,3}):(\d{2})/.exec((v ?? "").trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

const LEAVE_CODES = new Set(["PL", "SL", "CL", "EL", "ML", "LV", "LWP", "CO"]);

/**
 * Collapses the two half-day codes into one daily outcome.
 * A day with any present half (or a missing punch) is an attended day, matching how the
 * monthly tracker has always counted "present days".
 */
export function deriveStatus(first: string, second: string): DayStatus {
  const a = first.toUpperCase();
  const b = second.toUpperCase();
  if (a === "WO" && b === "WO") return "Week Off";
  if (a === "PH" || b === "PH") return "Holiday";
  if (a === "PR" && b === "PR") return "Present";
  if (a === "IN" || b === "IN") return "Incomplete";
  if (a === "PR" || b === "PR") return "Present"; // there is no half day: the hours worked say how much
  if (LEAVE_CODES.has(a) && LEAVE_CODES.has(b)) return "Leave";
  if (a === "AB" && b === "AB") return "Absent";
  if ((a === "AB" || LEAVE_CODES.has(a)) && (b === "AB" || LEAVE_CODES.has(b))) return "Absent";
  if (a === "WO" || b === "WO") return "Week Off";
  return "Unknown";
}

/**
 * The stored outcome for a day. The biometric system's "half day" is not a status here: someone who
 * attended is Present, and the hours they worked (less, full or overtime) are what is graded.
 * Days on our holiday calendar are never anything else, whatever the punches say.
 */
export function dayOutcome(
  first: string,
  second: string,
  workMin: number | null,
  workDate: string,
  holidays: ReadonlySet<string> = new Set(),
  punched = false,
): DayStatus {
  if (holidays.has(workDate)) return "Holiday";
  const status = deriveStatus(first, second);
  // Someone who punched in AND out was there: fewer hours is a lower hours total, never an absence.
  if ((status === "Absent" || status === "Unknown") && (workMin ?? 0) > 0) return "Present";
  // Our holiday calendar is the authority. If the biometric calendar calls a day a holiday that is
  // not on ours it was a working day: punched in is Present (or Incomplete), no punch is Absent.
  if (status === "Holiday") return punched ? (workMin ? "Present" : "Incomplete") : "Absent";
  return status;
}

export const KNOWN_HALF_CODES = new Set(["PR", "AB", "WO", "PH", "IN", ...LEAVE_CODES]);

/** "YYYY-MM-DD" from dd/mm/yyyy; null when malformed or not a real date. */
export function dmyToIso(dmy: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(dmy.trim());
  if (!m) return null;
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
