import snapshot from "../data/fallback-dashboard.json";

export type FallbackRangeMap = Record<string, string[][]>;

export function fallbackBatchGet(ranges: string[]): FallbackRangeMap {
  const source = snapshot.ranges as Record<string, string[][]>;
  return Object.fromEntries(ranges.map((range) => [range, source[range] ?? []]));
}

export function hasFallbackData(): boolean {
  return Object.keys(snapshot.ranges as Record<string, string[][]>).length > 0;
}
