/**
 * Indian vehicle registration (RTO) plate helpers.
 * Formats: KL12P2727, KL-12-P-2727, KL 12 P 2727, KL-12-P-2727, etc.
 */

/** Capture groups loosely cover state(2) + RTO(1–2) + series(0–3 letters) + number(1–4). */
export const INDIAN_REGISTRATION_RE =
  /\b([A-Z]{2})\s*[-\s]?(\d{1,2})\s*[-\s]?([A-Z]{0,3})\s*[-\s]?(\d{1,4})\b/gi;

/** Normalize by removing spaces/hyphens and uppercasing (KL12P2727). */
export function normalizeIndianRegistration(value?: string | null): string | undefined {
  if (!value) return undefined;
  const cleaned = value.trim().toUpperCase().replace(/[\s\-]/g, '');
  if (!/^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{1,4}$/.test(cleaned)) return undefined;
  return cleaned;
}

/** Format for display: KL-12-P-2727 when series present, else KL-12-2727. */
export function formatIndianRegistration(normalized?: string | null): string | undefined {
  const n = normalizeIndianRegistration(normalized) || (normalized || '').toUpperCase().replace(/[\s\-]/g, '');
  if (!n) return undefined;
  const m = /^([A-Z]{2})(\d{1,2})([A-Z]{0,3})(\d{1,4})$/.exec(n);
  if (!m) return n;
  const [, st, rto, series, num] = m;
  return series ? `${st}-${rto}-${series}-${num}` : `${st}-${rto}-${num}`;
}

/** Extract all plausible Indian registrations from free text. */
export function extractIndianRegistrations(text?: string | null): string[] {
  if (!text) return [];
  const found = new Set<string>();
  const re = new RegExp(INDIAN_REGISTRATION_RE.source, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const raw = `${m[1]}${m[2]}${m[3] || ''}${m[4]}`;
    const norm = normalizeIndianRegistration(raw);
    if (norm) found.add(norm);
  }
  return [...found];
}

/** Both compact and hyphenated forms for Gmail search. */
export function registrationSearchForms(value: string): { compact: string; hyphenated: string } {
  const compact = normalizeIndianRegistration(value) || value.toUpperCase().replace(/[\s\-]/g, '');
  const hyphenated = formatIndianRegistration(compact) || compact;
  return { compact, hyphenated };
}
