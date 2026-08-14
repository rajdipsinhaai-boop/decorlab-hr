/** Month labels formatted like the sheet ("August 2026"), newest first. */
export function monthOptions(known: string[] = []): string[] {
  const now = new Date();
  const generated: string[] = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    generated.push(
      `${d.toLocaleString("en-US", { month: "long", timeZone: "UTC" })} ${d.getUTCFullYear()}`,
    );
  }
  return Array.from(new Set([...generated, ...known.filter(Boolean)]));
}

export function currentMonthLabel(): string {
  return monthOptions()[0]!;
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the selected file."));
    reader.onload = () => {
      const result = String(reader.result ?? "");
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.readAsDataURL(file);
  });
}