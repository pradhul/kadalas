/**
 * Pre-triage filter for junk / decorative email attachments
 * (footers, logos, tracking pixels, Outlook inline images, etc.).
 */

export const DECORATION_SKIP_LABEL = 'Filtered: email decoration';

/** Images at or below this size are dropped unless a strong document hint is present. */
export const SMALL_IMAGE_MAX_BYTES = 50 * 1024;

const DECORATION_NAME =
  /^(?:footer|header|logo|banner|icon|spacer|signature|social|tracking|pixel|badge|btn|button)[-_.0-9]*/i;

const DECORATION_SUBSTRING =
  /(?:^|[-_\s.])(footer|header|logo|banner|icon|spacer|signature|social|facebook|twitter|linkedin|instagram|whatsapp|youtube|pixel|tracking)(?:[-_\s.]|$)/i;

/** Outlook / Word HTML-mail inline names: image001.png, image002.jpg, … */
const OUTLOOK_INLINE = /^image\d{3,}\.(?:png|jpe?g|gif|bmp|webp)$/i;

/** Federal Bank / bank template footers: Footer-0-0.jpg */
const NUMBERED_FOOTER = /^(?:footer|header|banner|logo)[-_]?\d+[-_]?\d*\.(?:png|jpe?g|gif|webp)$/i;

const DOC_HINT_NAME =
  /aadhaar|aadhar|\bpan\b|statement|policy|ticket|invoice|receipt|passport|licence|license|form[\s_-]?16|itr|payslip|salary|boarding|pnr|rc[\s_-]?book|insurance|premium|passbook|cheque|check/i;

const DOC_HINT_TEXT =
  /aadhaar|aadhar|\bpan\b|statement|policy|ticket|invoice|receipt|passport|form\s*16|itr|payslip|boarding|insurance/i;

export type AttachmentFilterInput = {
  fileName?: string;
  mimeType?: string;
  size?: number;
  subject?: string;
  from?: string;
  snippet?: string;
  /** Content-Disposition header value */
  contentDisposition?: string;
  /** Content-ID without angle brackets */
  contentId?: string;
  /** True when HTML body references cid:<contentId> */
  referencedAsCid?: boolean;
  /** Explicit inline flag from Gmail part */
  isInline?: boolean;
  /** Content hash / fingerprint when known (for cross-email dedupe) */
  contentHash?: string;
};

export type AttachmentFilterResult = {
  keep: boolean;
  reason?: string;
};

export function hasStrongDocumentHint(input: AttachmentFilterInput): boolean {
  const name = input.fileName ?? '';
  if (DOC_HINT_NAME.test(name)) return true;
  const hay = [input.subject, input.snippet, input.from].filter(Boolean).join(' ');
  return DOC_HINT_TEXT.test(hay) && /\.(?:pdf|jpe?g|png|webp|tif{1,2})$/i.test(name);
}

export function isDecorationFileName(fileName: string): boolean {
  const base = fileName.replace(/^.*[/\\]/, '').trim();
  if (!base) return false;
  if (OUTLOOK_INLINE.test(base)) return true;
  if (NUMBERED_FOOTER.test(base)) return true;
  if (DECORATION_NAME.test(base)) return true;
  if (DECORATION_SUBSTRING.test(base)) return true;
  if (/\.gif$/i.test(base)) return true;
  return false;
}

export function isInlinePart(input: AttachmentFilterInput): boolean {
  if (input.isInline) return true;
  if (input.referencedAsCid) return true;
  const disp = (input.contentDisposition || '').toLowerCase();
  if (disp.includes('inline')) return true;
  // Parts with Content-ID are almost always embedded HTML decorations
  if (input.contentId && !hasStrongDocumentHint(input)) return true;
  return false;
}

export function isPdf(input: AttachmentFilterInput): boolean {
  const mime = (input.mimeType || '').toLowerCase();
  const name = input.fileName || '';
  return mime.includes('pdf') || /\.pdf$/i.test(name);
}

export function isImage(input: AttachmentFilterInput): boolean {
  const mime = (input.mimeType || '').toLowerCase();
  const name = input.fileName || '';
  return mime.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|tif{1,2})$/i.test(name);
}

/**
 * Fingerprint for cross-email decoration dedupe when full content hash is unknown.
 * Same Footer-0-0.jpg at the same size appearing in every Federal Bank mail collapses.
 */
export function decorationFingerprint(input: AttachmentFilterInput): string {
  if (input.contentHash) return `hash:${input.contentHash}`;
  const base = (input.fileName || '').replace(/^.*[/\\]/, '').toLowerCase();
  const size = input.size ?? 0;
  const mime = (input.mimeType || '').toLowerCase();
  return `meta:${base}::${size}::${mime}`;
}

/**
 * Decide whether an attachment should enter triage / review.
 * Prefer PDFs; keep images only when meaningful (doc hint or large enough + not decorative).
 */
export function evaluateAttachment(input: AttachmentFilterInput): AttachmentFilterResult {
  const name = input.fileName || '';
  const size = input.size ?? 0;

  if (!name && !input.mimeType) {
    return { keep: false, reason: 'empty attachment' };
  }

  if (/\.(gif|bmp|svg)$/i.test(name)) {
    return { keep: false, reason: DECORATION_SKIP_LABEL };
  }

  if (isInlinePart(input) && !hasStrongDocumentHint(input)) {
    return { keep: false, reason: DECORATION_SKIP_LABEL };
  }

  if (isDecorationFileName(name) && !hasStrongDocumentHint(input)) {
    return { keep: false, reason: DECORATION_SKIP_LABEL };
  }

  if (isPdf(input)) {
    return { keep: true };
  }

  if (isImage(input)) {
    if (hasStrongDocumentHint(input)) return { keep: true };
    if (size > 0 && size <= SMALL_IMAGE_MAX_BYTES) {
      return { keep: false, reason: DECORATION_SKIP_LABEL };
    }
    // Large image without decoration name — keep for triage
    return { keep: true };
  }

  // Non image/pdf — keep if allowed extension via caller; default keep for octet-stream docs
  return { keep: true };
}

/** Stateful cross-message dedupe for a single scan / load pass. */
export class AttachmentDedupeSet {
  private seen = new Set<string>();

  /** Returns true if this fingerprint was already seen (should drop). */
  take(input: AttachmentFilterInput): boolean {
    // Only dedupe decoration-like or small images — real unique docs with same name are rare
    // but Aadhaar.jpg from different people should not collide on name alone without size match
    // for non-decoration. For decoration patterns OR small images, dedupe aggressively.
    const decorative =
      isDecorationFileName(input.fileName || '') ||
      isInlinePart(input) ||
      (isImage(input) && (input.size ?? 0) > 0 && (input.size ?? 0) <= SMALL_IMAGE_MAX_BYTES);
    if (!decorative && !input.contentHash) return false;
    const fp = decorationFingerprint(input);
    if (this.seen.has(fp)) return true;
    this.seen.add(fp);
    return false;
  }

  has(input: AttachmentFilterInput): boolean {
    return this.seen.has(decorationFingerprint(input));
  }
}

export function shouldKeepAttachment(
  input: AttachmentFilterInput,
  dedupe?: AttachmentDedupeSet,
): boolean {
  const result = evaluateAttachment(input);
  if (!result.keep) {
    // Still record fingerprint so later identical junk is skipped even if first was filtered elsewhere
    dedupe?.take(input);
    return false;
  }
  if (dedupe?.take(input)) return false;
  return true;
}

/** Pending review candidates that look like decorations — auto-skip on load. */
export function isPendingDecorationCandidate(c: {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  subject?: string;
  from?: string;
  previewSnippet?: string;
  contentRef?: string;
  status: string;
}): boolean {
  if (c.status !== 'pending' && c.status !== 'needs_subject_confirm') return false;
  const result = evaluateAttachment({
    fileName: c.fileName,
    mimeType: c.mimeType,
    size: c.sizeBytes,
    subject: c.subject,
    from: c.from,
    snippet: c.previewSnippet,
    contentHash: c.contentRef,
  });
  return !result.keep;
}
