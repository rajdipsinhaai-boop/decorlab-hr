/** One person on one day, exactly as the biometric (COSEC) report states it, normalised to clean types. */
export interface ParsedDay {
  /** Calendar date the report row belongs to, YYYY-MM-DD. */
  workDate: string;
  /** Biometric user id, e.g. "D100". The stable identity key across months. */
  cosecId: string;
  /** Name as printed in the report (spelling varies between exports). */
  name: string;
  shift: string | null;
  /** Local wall-clock punches, "YYYY-MM-DDTHH:MM:SS" (no timezone). May fall on the adjacent date for night work. */
  inAt: string | null;
  outAt: string | null;
  in2At: string | null;
  out2At: string | null;
  /** Raw half-day codes: PR present, AB absent, WO week off, PH holiday, PL paid leave, IN incomplete. */
  firstHalf: string;
  secondHalf: string;
  lateInMin: number | null;
  earlyOutMin: number | null;
  workMin: number | null;
  manualEntry: boolean;
  reason: string | null;
}

export interface ParsedPerson {
  cosecId: string;
  name: string;
  shift: string | null;
  days: number;
}

export interface ParsedReport {
  format: "xlsx" | "pdf";
  /** Reporting window printed in the title, YYYY-MM-DD. */
  periodStart: string;
  periodEnd: string;
  runBy: string | null;
  days: ParsedDay[];
  people: ParsedPerson[];
  /** Non-fatal oddities found while parsing. Never silently dropped. */
  warnings: string[];
}

/** Normalised daily outcome stored in the database. */
export type DayStatus =
  | "Present"
  | "Half Day"
  | "Incomplete"
  | "Absent"
  | "Week Off"
  | "Holiday"
  | "Leave"
  | "Unknown";

/** Days that count toward "present days" (a half day or a missing punch is still a day worked). */
export const ATTENDED_STATUSES: readonly DayStatus[] = ["Present", "Half Day", "Incomplete"];

export class AttendanceParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AttendanceParseError";
  }
}
