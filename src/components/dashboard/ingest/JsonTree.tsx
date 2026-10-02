export const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function Leaf({ value }: { value: unknown }) {
  if (value === null || value === undefined)
    return <span className="italic text-muted-foreground">null</span>;
  if (typeof value === "number") return <span className="tabular-nums text-primary">{value}</span>;
  if (typeof value === "boolean") return <span className="text-warning">{String(value)}</span>;
  return <span className="break-words text-foreground">{String(value)}</span>;
}

/** Collapsible view of any JSON value, so no field of a payload is ever hidden. */
export function JsonTree({
  value,
  label,
  depth = 0,
}: {
  value: unknown;
  label: string;
  depth?: number;
}) {
  const isArr = Array.isArray(value);
  if (!isArr && !isRecord(value)) {
    return (
      <div className="py-0.5 text-xs">
        <span className="text-muted-foreground">{label}: </span>
        <Leaf value={value} />
      </div>
    );
  }
  const entries: [string, unknown][] = isArr
    ? (value as unknown[]).map((v, i) => [String(i), v])
    : Object.entries(value as Record<string, unknown>);
  return (
    <details open={depth < 1} className="text-xs">
      <summary className="cursor-pointer select-none py-0.5 text-muted-foreground hover:text-foreground">
        <span className="font-medium text-foreground">{label}</span>{" "}
        <span>{isArr ? `[${entries.length}]` : `{${entries.length}}`}</span>
      </summary>
      <div className="ml-3 border-l border-border/60 pl-3">
        {entries.length === 0 ? (
          <span className="italic text-muted-foreground">empty</span>
        ) : (
          entries.map(([k, v]) => <JsonTree key={k} label={k} value={v} depth={depth + 1} />)
        )}
      </div>
    </details>
  );
}
