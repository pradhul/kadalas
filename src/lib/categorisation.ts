import { ClassificationResult, DocumentMetadata, VaultCategory } from '../types/document';
import { normalizeCategory } from './folders';

const PROMO_PATTERNS = [
  /unsubscribe/i,
  /newsletter/i,
  /% off/i,
  /sale ends/i,
  /limited time/i,
  /click here to (buy|shop)/i,
  /marketing/i,
];

const DOC_HINT_PATTERNS = [
  /policy/i,
  /statement/i,
  /invoice/i,
  /receipt/i,
  /tax/i,
  /passport/i,
  /license|licence/i,
  /warranty/i,
  /certificate/i,
  /contract/i,
  /renewal/i,
  /premium/i,
  /account\s*(no|number|#)/i,
  /aadhaar|aadhar/i,
  /\bpan\b/i,
  /form\s*16/i,
  /itr/i,
  /salary\s*slip|payslip/i,
  /credit\s*card/i,
  /irctc|pnr/i,
  /mediassist/i,
];

const ATTACHMENT_ALLOW = [/\.pdf$/i, /\.png$/i, /\.jpe?g$/i, /\.webp$/i, /\.tif{1,2}$/i];

/** Sender domains → category hint (lowercase host). */
const SENDER_DOMAIN_HINTS: Array<{ test: RegExp; category: VaultCategory }> = [
  { test: /@hdfcbank\.|@hdfcbank\.com/i, category: 'Banking' },
  { test: /@sbi\.co\.|@onlinesbi\./i, category: 'Banking' },
  { test: /@icicibank\.|@icici\.com/i, category: 'Banking' },
  { test: /@axisbank\./i, category: 'Banking' },
  { test: /@bankofbaroda\.|@bobibanking\./i, category: 'Banking' },
  { test: /@kotak\.com/i, category: 'Banking' },
  { test: /@hdfcergo\.|@icicilombard\.|@bajajallianz\./i, category: 'Insurance/Vehicle' },
  { test: /@mediassist\.|@starhealth\./i, category: 'Insurance/Health' },
  { test: /@irctc\./i, category: 'Travel' },
  { test: /@incometax\.|@tdscpc\.|@in\.gov/i, category: 'Tax' },
  { test: /@uidai\.|@egov\./i, category: 'Identity' },
];

/** Filename substrings (without path) → category. */
const FILENAME_HINTS: Array<{ test: RegExp; category: VaultCategory }> = [
  { test: /aadhaar|aadhar/i, category: 'Identity' },
  { test: /\bpan[_\s-]?card|\bpan\.pdf/i, category: 'Identity' },
  { test: /form[_\s-]?16/i, category: 'Tax' },
  { test: /26as|itr/i, category: 'Tax' },
  { test: /salary|payslip/i, category: 'Tax' },
  { test: /bank.*statement|statement.*\d{4}/i, category: 'Banking' },
  { test: /credit.?card/i, category: 'Bills' },
  { test: /policy|motor|vehicle|chassis/i, category: 'Insurance/Vehicle' },
  { test: /boarding|pnr|ticket/i, category: 'Travel' },
  { test: /invoice|receipt/i, category: 'Warranties' },
  { test: /electricity|bescom|jio|airtel/i, category: 'Bills' },
];

export interface HeuristicInput {
  subject?: string;
  from?: string;
  snippet?: string;
  fileName?: string;
  mimeType?: string;
}

/**
 * Cheap pre-filter before spending AI calls.
 * Returns false for obvious promos / non-document attachments.
 */
export function shouldConsiderAttachment(input: HeuristicInput): boolean {
  const name = input.fileName ?? '';
  const mime = input.mimeType ?? '';

  const allowedExt = ATTACHMENT_ALLOW.some((re) => re.test(name));
  const allowedMime =
    mime.includes('pdf') ||
    mime.includes('image/') ||
    mime === 'application/octet-stream' ||
    mime === '';

  if (!allowedExt && !allowedMime) return false;
  if (/\.(gif|bmp|svg)$/i.test(name)) return false;

  const haystack = [input.subject, input.from, input.snippet, name].filter(Boolean).join(' ');
  if (PROMO_PATTERNS.some((re) => re.test(haystack)) && !DOC_HINT_PATTERNS.some((re) => re.test(haystack))) {
    return false;
  }

  return true;
}

function categoryFromSenderAndFilename(input: HeuristicInput): VaultCategory | undefined {
  const from = input.from ?? '';
  for (const rule of SENDER_DOMAIN_HINTS) {
    if (rule.test.test(from)) return rule.category;
  }
  const baseName = (input.fileName ?? '').replace(/^.*[/\\]/, '');
  for (const rule of FILENAME_HINTS) {
    if (rule.test.test(baseName)) return rule.category;
  }
  return undefined;
}

/** Rule-based classification used when no AI key is configured. */
export function classifyWithRules(input: HeuristicInput & { textExcerpt?: string }): ClassificationResult {
  const haystack = [input.subject, input.from, input.fileName, input.textExcerpt, input.snippet]
    .filter(Boolean)
    .join(' \n ');

  const hintCategory = categoryFromSenderAndFilename(input);
  const normalized = normalizeCategory(haystack);
  const category =
    hintCategory && (normalized === 'Other' || hintCategory !== 'Other') ? hintCategory : normalized;
  const issuer = extractIssuer(input.from, haystack);
  const documentType = guessDocumentType(haystack, category);
  const referenceNumber = extractReference(haystack);
  const dates = extractDates(haystack);
  const isImportant =
    DOC_HINT_PATTERNS.some((re) => re.test(haystack)) ||
    Boolean(referenceNumber) ||
    Boolean(hintCategory) ||
    category !== 'Other';

  const title = buildTitle({
    issuer,
    documentType,
    fileName: input.fileName,
    subject: input.subject,
  });

  const metadata: DocumentMetadata = {
    issuer,
    documentType,
    referenceNumber,
    issueDate: dates.issueDate,
    expiryDate: dates.expiryDate,
  };

  return {
    category,
    title,
    metadata,
    confidence: isImportant ? 0.55 : 0.25,
    isImportantDocument: isImportant,
    reason: isImportant
      ? hintCategory
        ? 'Matched sender/filename hints and document keywords'
        : 'Matched document keywords / patterns'
      : 'Weak document signals',
  };
}

export function mergeClassification(
  base: ClassificationResult,
  override: Partial<ClassificationResult> & { metadata?: DocumentMetadata },
): ClassificationResult {
  return {
    ...base,
    ...override,
    category: (override.category as VaultCategory) ?? base.category,
    metadata: { ...base.metadata, ...override.metadata },
  };
}

function extractIssuer(from?: string, haystack?: string): string | undefined {
  if (from) {
    const angle = /^(?:"?([^"<]+)"?\s*)?<?([^>]+@[^>]+)>?$/.exec(from.trim());
    if (angle?.[1]?.trim()) return angle[1].trim();
    if (angle?.[2]) {
      const domain = angle[2].split('@')[1]?.split('.')[0];
      if (domain && domain !== 'gmail' && domain !== 'googlemail') {
        return domain.charAt(0).toUpperCase() + domain.slice(1);
      }
    }
  }
  const known =
    /(geico|progressive|state farm|allstate|aetna|unitedhealthcare|chase|bank of america|wells fargo|irs|hmrc|hdfc|sbi|icici|axis|bajaj allianz|mediassist|irctc|uidai)/i.exec(
      haystack ?? '',
    );
  return known?.[1]?.replace(/\s+/g, ' ');
}

function guessDocumentType(haystack: string, category: VaultCategory): string {
  if (/renewal/i.test(haystack)) return 'Renewal notice';
  if (/salary\s*slip|payslip/i.test(haystack)) return 'Salary slip';
  if (/form\s*16/i.test(haystack)) return 'Form 16';
  if (/26as/i.test(haystack)) return 'Form 26AS';
  if (/aadhaar|aadhar/i.test(haystack)) return 'Aadhaar';
  if (/\bpan\b/i.test(haystack)) return 'PAN card';
  if (/statement/i.test(haystack)) return 'Account statement';
  if (/credit\s*card/i.test(haystack)) return 'Credit card statement';
  if (/invoice/i.test(haystack)) return 'Invoice';
  if (/receipt/i.test(haystack)) return 'Receipt';
  if (/policy/i.test(haystack)) return 'Policy document';
  if (/passport/i.test(haystack)) return 'Passport';
  if (/tax|w-?2|1099|itr/i.test(haystack)) return 'Tax document';
  if (/boarding|ticket|pnr/i.test(haystack)) return 'Travel ticket';
  if (category.startsWith('Insurance')) return 'Insurance document';
  if (category === 'Banking') return 'Banking document';
  return 'Document';
}

function extractReference(haystack: string): string | undefined {
  const patterns = [
    /(?:policy|account|ref(?:erence)?|claim)\s*(?:no\.?|number|#)?\s*[:#]?\s*([A-Z0-9-]{5,})/i,
    /\b([A-Z]{2,}\d{4,}[A-Z0-9-]*)\b/,
  ];
  for (const re of patterns) {
    const m = re.exec(haystack);
    if (m?.[1]) return m[1];
  }
  return undefined;
}

function extractDates(haystack: string): { issueDate?: string; expiryDate?: string } {
  const isoDates = [...haystack.matchAll(/\b(20\d{2})-(\d{2})-(\d{2})\b/g)].map((m) => m[0]);
  const slashDates = [...haystack.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/g)].map((m) => {
    const mm = m[1].padStart(2, '0');
    const dd = m[2].padStart(2, '0');
    return `${m[3]}-${mm}-${dd}`;
  });
  const all = [...isoDates, ...slashDates];
  const expiryHint = /expir|renew|valid\s+until|valid\s+thru/i.test(haystack);
  return {
    issueDate: all[0],
    expiryDate: expiryHint ? all[1] ?? all[0] : all[1],
  };
}

function buildTitle(input: {
  issuer?: string;
  documentType?: string;
  fileName?: string;
  subject?: string;
}): string {
  if (input.issuer && input.documentType) return `${input.issuer} ${input.documentType}`;
  if (input.subject?.trim()) return input.subject.trim().slice(0, 80);
  if (input.fileName) return input.fileName.replace(/\.[^.]+$/, '');
  return 'Untitled document';
}