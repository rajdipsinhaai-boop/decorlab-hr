/** Minimal RFC4180 CSV parser (handles quoted fields and embedded newlines). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => v.trim() !== ""));
}

export function headerIndexOf(headers: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  headers.forEach((h, i) => {
    const key = h.replace(/\s+/g, " ").trim().toLowerCase();
    if (key && !(key in map)) map[key] = i;
  });
  return map;
}

export function findCol(map: Record<string, number>, ...needles: string[]): number {
  for (const needle of needles) {
    const n = needle.toLowerCase();
    if (map[n] !== undefined) return map[n]!;
    const partial = Object.keys(map).find((k) => k.includes(n));
    if (partial) return map[partial]!;
  }
  return -1;
}