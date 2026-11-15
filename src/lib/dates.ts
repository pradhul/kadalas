/** Parse ISO dates, slash dates, or policy year ranges like 2026-27. */
export function parseFlexibleDate(value?: string | null): number | null {
  if (!value) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (iso) return Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const range = /^(20\d{2})\s*[-/]\s*(\d{2})$/.exec(value.trim());
  if (range) {
    const endYear = 2000 + Number(range[2]);
    return Date.UTC(endYear, 5, 30);
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}
