/**
 * Manual save path: user emails a document to themselves with "kadalas" in subject/body.
 * Scopes stay gmail.readonly — we only search and index, never send/label/delete.
 */

import { gmailAddressesMatch } from './gmailAddress';

export const SELF_SENT_QUERY_BASE =
  'from:me to:me has:attachment (subject:kadalas OR kadalas)';

/** Build Gmail search for self-sent kadalas messages newer than an ISO timestamp. */
export function buildSelfSentQuery(newerThanIso?: string | null): string {
  const parts = [SELF_SENT_QUERY_BASE];
  if (newerThanIso) {
    const d = new Date(newerThanIso);
    if (!Number.isNaN(d.getTime())) {
      // Gmail after: is exclusive calendar day (YYYY/MM/DD)
      const y = d.getUTCFullYear();
      const m = String(d.getUTCMonth() + 1).padStart(2, '0');
      const day = String(d.getUTCDate()).padStart(2, '0');
      parts.push(`after:${y}/${m}/${day}`);
    }
  }
  return parts.join(' ');
}

export function isKadalasTaggedSubject(subject?: string | null): boolean {
  if (!subject) return false;
  return /\bkadalas\b/i.test(subject) || /#kadalas\b/i.test(subject);
}

export function isKadalasTaggedBody(body?: string | null): boolean {
  if (!body) return false;
  return /\bkadalas\b/i.test(body) || /#kadalas\b/i.test(body);
}

/** True when message is self-sent and tagged kadalas (subject or body). */
export function isSelfSentKadalasMessage(input: {
  from?: string | null;
  to?: string | null;
  subject?: string | null;
  snippetOrBody?: string | null;
  userEmail?: string | null;
}): boolean {
  const tagged =
    isKadalasTaggedSubject(input.subject) || isKadalasTaggedBody(input.snippetOrBody);
  if (!tagged) return false;
  if (!input.userEmail) {
    // from:me to:me query already constrains; still require tag
    return true;
  }
  // Gmail-normalize (dots / +tags) — never require exact To: string match
  const fromOk = gmailAddressesMatch(input.from, input.userEmail);
  const toOk = !input.to || gmailAddressesMatch(input.to, input.userEmail);
  return fromOk && toOk;
}

/**
 * Title hint from subject after the kadalas marker.
 * "kadalas: car RC" → "car RC"; "kadalas car RC" → "car RC"
 */
export function parseKadalasTitleHint(subject?: string | null): string | undefined {
  if (!subject) return undefined;
  const cleaned = subject.trim();
  const m =
    cleaned.match(/\bkadalas\s*[:\-–—]\s*(.+)$/i) ||
    cleaned.match(/\bkadalas\b\s+(.+)$/i) ||
    cleaned.match(/#kadalas\b\s*[:\-–—]?\s*(.+)$/i);
  const hint = (m?.[1] || '').trim();
  return hint || undefined;
}

export function selfSentDedupeKey(messageId: string, attachmentId: string): string {
  return `self:${messageId}:${attachmentId}`;
}

function normalizeEmail(value: string): string {
  return extractEmail(value) || value.trim().toLowerCase();
}

function extractEmail(value?: string | null): string | null {
  if (!value) return null;
  const m = value.match(/[\w.+-]+@[\w.-]+\.\w+/);
  return m ? m[0].toLowerCase() : value.trim().toLowerCase() || null;
}

export function mailtoKadalasCompose(ownEmail: string, subjectHint = 'kadalas: '): string {
  return `mailto:${encodeURIComponent(ownEmail)}?subject=${encodeURIComponent(subjectHint)}`;
}
