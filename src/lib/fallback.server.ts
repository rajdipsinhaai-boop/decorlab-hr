import snapshot from "../data/fallback-dashboard.json";

import augustSnapshot from "@/data/august-dashboard.json";

export type FallbackRangeMap = Record<string, string[][]>;

const JULY = "July 2026";
const AUGUST = "August 2026";

export function fallbackBatchGet(ranges: string[], month = JULY): FallbackRangeMap {
  const selected = month === AUGUST ? augustSnapshot : snapshot;
  const source = selected.ranges as Record<string, string[][]>;
  return Object.fromEntries(ranges.map((range) => [range, source[range] ?? []]));
}

export function hasFallbackData(): boolean {
  return Object.keys(snapshot.ranges as Record<string, string[][]>).length > 0;
}
