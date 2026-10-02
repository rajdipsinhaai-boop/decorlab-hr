import { ATTENDED_STATUSES, type DayStatus } from "./types";

/** Office start used for punctuality, in minutes after midnight (10:00). */
export const SCHEDULED_START_MINUTES = 10 * 60;
/** Required duty per day: 8 hours 30 minutes, the same for everyone. */
export const TARGET_HOURS = 8.5;

/** A stored daily record, as the dashboard needs it. */
export interface DayRecord {
  workDate: string; // YYYY-MM-DD
  status: DayStatus | string;
  inAt: string | null;
  outAt: string | null;
  workMin: number | null;
}

export interface MonthMetrics {
  presentDays: number;
  halfDays: number;
  absentDays: number;
  leaveDays: number;
  avgHours: number;
  /** Mean minutes after the scheduled start (negative = early). 0 when there are no usable punches. */
  punctualityDeviation: number;
}

const attended = (s: string) => (ATTENDED_STATUSES as readonly string[]).includes(s);

/**
 * Only a normal morning arrival on the day itself counts toward punctuality. Night-shift starts,
 * the previous evening's punch and the device's 00:00 placeholder would otherwise skew the average.
 */
export function arrivalMinutes(d: DayRecord): number | null {
  if (!d.inAt || d.inAt.slice(0, 10) !== d.workDate) return null;
  const m = /T(\d{2}):(\d{2})/.exec(d.inAt);
  if (!m) return null;
  const minutes = Number(m[1]) * 60 + Number(m[2]);
  return minutes >= 4 * 60 && minutes <= 16 * 60 ? minutes : null;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function summarizeMonth(days: DayRecord[], startMin: number = SCHEDULED_START_MINUTES): MonthMetrics {
  const present = days.filter((d) => attended(d.status));
  const hours = present.map((d) => (d.workMin ?? 0) / 60).filter((h) => h > 0);
  const deviations = present
    .map(arrivalMinutes)
    .filter((m): m is number => m !== null)
    .map((m) => m - startMin);
  return {
    presentDays: present.length,
    halfDays: days.filter((d) => d.status === "Half Day").length,
    absentDays: days.filter((d) => d.status === "Absent").length,
    leaveDays: days.filter((d) => d.status === "Leave").length,
    avgHours: hours.length ? round1(hours.reduce((a, b) => a + b, 0) / hours.length) : 0,
    punctualityDeviation: deviations.length
      ? Math.round(deviations.reduce((a, b) => a + b, 0) / deviations.length)
      : 0,
  };
}

/** Calendar days in a month minus Sundays: the denominator the KRA audit uses. */
export function workingDaysInMonth(monthKey: string): number {
  const [y, m] = monthKey.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  let n = 0;
  for (let d = 1; d <= last; d++) if (new Date(Date.UTC(y, m - 1, d)).getUTCDay() !== 0) n++;
  return n;
}
