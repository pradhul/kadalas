import { extractIndianRegistrations, normalizeIndianRegistration, registrationSearchForms } from './indianRegistration';
import { GmailAttachmentMeta } from '../services/gmail/types';
import { VaultDocument } from '../types/document';

/** Insurer / aggregator domains that often carry policy PDFs. */
export const KNOWN_INSURER_DOMAINS = [
  'newindia.co.in',
  'uiic.co.in',
  'icicilombard.com',
  'hdfcergo.com',
  'bajajallianz.co.in',
  'tataaig.com',
  'acko.com',
  'godigit.com',
  'policybazaar.com',
  'phonepe.com',
] as const;

export type MessageHint = {
  messageId: string;
  threadId?: string;
  from: string;
  to?: string;
  subject: string;
  snippet: string;
  date: string;
  hasAttachment: boolean;
};

export type LinkedDocHints = {
  registrationNumber?: string;
  referenceNumber?: string;
  issuerHint?: string;
  linkedFromMessageId?: string;
  linkedFromSubject?: string;
};

/** Extract policy / reference numbers from subject or body. */
export function extractPolicyNumbers(text?: string | null): string[] {
  if (!text) return [];
  const found = new Set<string>();
  const patterns = [
    /POLICY\s*NUMBER\s*:?\s*<<?\s*([A-Z0-9]{8,})\s*>>?/gi,
    /policy\s*(?:number|no\.?|#)\s*[:#]?\s*([A-Z0-9]{8,})/gi,
    /policy\s+document\s+for\s+([A-Z0-9]{8,})/gi,
    /premium\s+receipt[^0-9]{0,40}([0-9]{12,20})/gi,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const n = (m[1] || '').replace(/[<>]/g, '').trim().toUpperCase();
      if (n.length >= 8 && !/^(DOCUMENT|SCHEDULE|NUMBER|POLICY|RECEIPT|PREMIUM)$/i.test(n)) {
        found.add(n);
      }
    }
  }
  // Bare long numeric policy ids (New India style)
  for (const m2 of text.matchAll(/\b(\d{12,20})\b/g)) {
    found.add(m2[1]);
  }
  return [...found];
}

export function attachmentDedupeKey(messageId: string, attachmentId: string): string {
  return `${messageId}::${attachmentId}`;
}

/** Targeted Gmail queries with no date limit — list attachments only. */
export function buildKnownDocsQueries(options?: {
  vehicleRegistrations?: string[];
}): string[] {
  const fromClause = KNOWN_INSURER_DOMAINS.map((d) => d).join(' OR ');
  const queries = [
    `in:anywhere from:(${fromClause}) has:attachment`,
    `in:anywhere ("motor policy" OR "policy schedule" OR "policy document" OR "premium receipt") has:attachment`,
    `in:anywhere has:attachment (policy OR schedule) (insurance OR assurance OR motor)`,
  ];

  for (const reg of options?.vehicleRegistrations || []) {
    const { compact, hyphenated } = registrationSearchForms(reg);
    if (!compact) continue;
    queries.push(
      `in:anywhere has:attachment (${compact} OR "${hyphenated}" OR ${hyphenated.replace(/-/g, ' ')})`,
    );
  }
  return queries;
}

/** Queries to find related emails (with or without attachments) for a policy/reg. */
export function buildRelatedMessageQueries(input: {
  policyNumbers?: string[];
  registrations?: string[];
  fromDomain?: string;
}): string[] {
  const out: string[] = [];
  for (const p of input.policyNumbers || []) {
    const clean = p.replace(/[<>\s]/g, '');
    if (clean.length < 8) continue;
    out.push(`in:anywhere (${clean} OR "<<${clean}>>")`);
    if (input.fromDomain) out.push(`in:anywhere from:${input.fromDomain} ${clean}`);
  }
  for (const reg of input.registrations || []) {
    const { compact, hyphenated } = registrationSearchForms(reg);
    out.push(`in:anywhere (${compact} OR "${hyphenated}")`);
  }
  return out;
}

/**
 * Link attachment-bearing emails to related hint emails that name the same
 * policy number or vehicle registration (e.g. New India Email A → Email B PDF).
 */
export function linkRelatedEmailHints(
  attachments: GmailAttachmentMeta[],
  hints: MessageHint[],
): Map<string, LinkedDocHints> {
  const linked = new Map<string, LinkedDocHints>();

  // Index hints by policy number and registration
  const byPolicy = new Map<string, MessageHint[]>();
  const byReg = new Map<string, MessageHint[]>();
  for (const h of hints) {
    const hay = `${h.subject}\n${h.snippet}`;
    for (const p of extractPolicyNumbers(hay)) {
      const list = byPolicy.get(p) || [];
      list.push(h);
      byPolicy.set(p, list);
    }
    for (const r of extractIndianRegistrations(hay)) {
      const list = byReg.get(r) || [];
      list.push(h);
      byReg.set(r, list);
    }
  }

  for (const att of attachments) {
    const key = attachmentDedupeKey(att.messageId, att.attachmentId);
    const hay = `${att.subject}\n${att.snippet}`;
    const policies = extractPolicyNumbers(hay);
    const regs = extractIndianRegistrations(hay);
    let registrationNumber = regs[0];
    let referenceNumber = policies[0];
    let linkedFrom: MessageHint | undefined;

    for (const p of policies) {
      for (const h of byPolicy.get(p) || []) {
        if (h.messageId === att.messageId) continue;
        const hintRegs = extractIndianRegistrations(`${h.subject}\n${h.snippet}`);
        if (hintRegs[0]) registrationNumber = registrationNumber || hintRegs[0];
        referenceNumber = referenceNumber || p;
        linkedFrom = h;
      }
    }

    // Same sender + nearby date / shared policy in either direction
    if (!registrationNumber) {
      for (const h of hints) {
        if (h.messageId === att.messageId) continue;
        const sameSender =
          domainOf(h.from) && domainOf(h.from) === domainOf(att.from);
        const hintPolicies = extractPolicyNumbers(`${h.subject}\n${h.snippet}`);
        const overlap = hintPolicies.some((p) => policies.includes(p));
        if (sameSender && (overlap || hintPolicies.length || policies.length)) {
          const hintRegs = extractIndianRegistrations(`${h.subject}\n${h.snippet}`);
          if (hintRegs[0]) {
            registrationNumber = hintRegs[0];
            referenceNumber = referenceNumber || hintPolicies[0] || policies[0];
            linkedFrom = h;
            break;
          }
        }
      }
    }

    if (registrationNumber || referenceNumber || linkedFrom) {
      linked.set(key, {
        registrationNumber: normalizeIndianRegistration(registrationNumber) || registrationNumber,
        referenceNumber,
        issuerHint: issuerFromDomain(domainOf(att.from) || domainOf(linkedFrom?.from)),
        linkedFromMessageId: linkedFrom?.messageId,
        linkedFromSubject: linkedFrom?.subject,
      });
    }
  }

  return linked;
}

/**
 * Simulate / unit-test helper: given lookback cutoff + fixtures, return PDF
 * candidates that the known-docs pass would surface (with vehicle linking).
 */
export function resolveKnownDocsFromFixtures(input: {
  messages: Array<MessageHint & { attachments?: GmailAttachmentMeta[] }>;
  lookbackAfterIso: string;
  alreadyIndexedKeys?: Set<string>;
  alreadySkippedKeys?: Set<string>;
}): Array<GmailAttachmentMeta & { linked?: LinkedDocHints }> {
  const after = Date.parse(input.lookbackAfterIso);
  const lookbackHits = input.messages.filter((m) => Date.parse(m.date) > after && m.hasAttachment);
  void lookbackHits; // lookback alone often misses older policies

  const knownDomain = new RegExp(
    KNOWN_INSURER_DOMAINS.map((d) => d.replace(/\./g, '\\.')).join('|'),
    'i',
  );
  const keyword =
    /motor policy|policy schedule|policy document|premium receipt|insurance|assurance|motor/i;

  const hints: MessageHint[] = input.messages.map((m) => ({
    messageId: m.messageId,
    threadId: m.threadId,
    from: m.from,
    to: m.to,
    subject: m.subject,
    snippet: m.snippet,
    date: m.date,
    hasAttachment: m.hasAttachment,
  }));

  const attachments: GmailAttachmentMeta[] = [];
  for (const m of input.messages) {
    if (!m.attachments?.length) continue;
    const hay = `${m.subject}\n${m.snippet}\n${m.from}`;
    const matchesKnown =
      knownDomain.test(m.from) || keyword.test(hay) || extractPolicyNumbers(hay).length > 0;
    if (!matchesKnown) continue;
    for (const att of m.attachments) {
      const key = attachmentDedupeKey(att.messageId, att.attachmentId);
      if (input.alreadyIndexedKeys?.has(key)) continue;
      if (input.alreadySkippedKeys?.has(key)) continue;
      attachments.push(att);
    }
  }

  const linkedMap = linkRelatedEmailHints(attachments, hints);
  return attachments.map((att) => ({
    ...att,
    linked: linkedMap.get(attachmentDedupeKey(att.messageId, att.attachmentId)),
  }));
}

/** Collect normalized vehicle regs already in the vault. */
export function vehicleRegistrationsFromVault(docs: VaultDocument[]): string[] {
  const out = new Set<string>();
  for (const d of docs) {
    const n = normalizeIndianRegistration(d.metadata.registrationNumber);
    if (n) out.add(n);
    const fromKey = d.metadata.subjectKey?.startsWith('vehicle:reg:')
      ? d.metadata.subjectKey.slice('vehicle:reg:'.length)
      : null;
    const nk = normalizeIndianRegistration(fromKey);
    if (nk) out.add(nk);
  }
  return [...out];
}

function domainOf(from?: string): string | null {
  if (!from) return null;
  const m = /@([a-z0-9.-]+\.[a-z]{2,})/i.exec(from);
  return m ? m[1].toLowerCase() : null;
}

function issuerFromDomain(domain?: string | null): string | undefined {
  if (!domain) return undefined;
  if (/newindia/i.test(domain)) return 'New India Assurance';
  if (/uiic/i.test(domain)) return 'United India Insurance';
  if (/icicilombard/i.test(domain)) return 'ICICI Lombard';
  if (/hdfcergo/i.test(domain)) return 'HDFC Ergo';
  if (/bajajallianz/i.test(domain)) return 'Bajaj Allianz';
  if (/tataaig/i.test(domain)) return 'Tata AIG';
  if (/acko/i.test(domain)) return 'Acko';
  if (/godigit|digit/i.test(domain)) return 'Go Digit';
  if (/policybazaar/i.test(domain)) return 'Policybazaar';
  if (/phonepe/i.test(domain)) return 'PhonePe';
  return undefined;
}
