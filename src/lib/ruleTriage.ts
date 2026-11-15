import { shouldConsiderAttachment } from './categorisation';
import { GmailAttachmentMeta } from '../services/gmail/types';

export const RULE_TRIAGE_DOC_KEYWORDS =
  /policy|statement|invoice|tax|passport|warranty|insurance|w-?2|renewal|bill|receipt|premium|certificate|payslip|salary|form\s?16|aadhaar|pan\b|e-?ticket|itinerary|booking|challan|registration/i;

export type RuleTriageDecision = {
  isLikelyImportant: boolean;
  confidence: number;
  reason: string;
};

export function ruleTriageOne(
  att: Pick<GmailAttachmentMeta, 'subject' | 'from' | 'filename' | 'mimeType' | 'snippet' | 'size'>,
): RuleTriageDecision {
  const keep = shouldConsiderAttachment({
    subject: att.subject,
    from: att.from,
    fileName: att.filename,
    mimeType: att.mimeType,
    snippet: att.snippet,
  });
  const hay = `${att.subject} ${att.filename} ${att.snippet}`;
  const strong = RULE_TRIAGE_DOC_KEYWORDS.test(hay);
  return {
    isLikelyImportant: keep && strong,
    confidence: keep && strong ? 0.7 : 0.25,
    reason: keep && strong ? 'Rule triage: document signals' : 'Rule triage: weak/junk signals',
  };
}

export function ruleTriage(
  items: Array<{
    id: string;
    attachment: Pick<GmailAttachmentMeta, 'subject' | 'from' | 'filename' | 'mimeType' | 'snippet' | 'size'>;
  }>,
): Array<{ id: string; isLikelyImportant: boolean; confidence: number; reason: string }> {
  return items.map((item) => ({ id: item.id, ...ruleTriageOne(item.attachment) }));
}
