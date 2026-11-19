/**
 * Fixtures mirroring the missed Tata Nexon KL-12-P-2727 New India policy emails
 * (21 Jul 2026, Updates tab, To: pradhuldev.1990@gmail.com).
 * No real attachment bytes — metadata only.
 */
import { GmailAttachmentMeta } from '../../src/services/gmail/types';
import { MessageHint } from '../../src/lib/knownDocsPass';

export const NEW_INDIA_POLICY = '76110031260300010312';
export const NEXON_REG = 'KL12P2727';

/** Email A — names vehicle + policy, no PDF. */
export const emailA: MessageHint = {
  messageId: 'msg_newindia_policy_notice',
  threadId: 'thread_newindia_nexon',
  from: 'New India Assurance <info@newindia.co.in>',
  to: 'pradhuldev.1990@gmail.com',
  subject: `POLICY NUMBER :<<${NEW_INDIA_POLICY}>>`,
  snippet: `Dear Customer, your motor policy for vehicle KL-12-P-2727 (Tata Nexon) is ready. Policy ${NEW_INDIA_POLICY}.`,
  date: '2026-07-21T08:10:00.000Z',
  hasAttachment: false,
};

/** Email B — Premium Receipt & Policy document with schedule PDF. */
export const emailBHint: MessageHint = {
  messageId: 'msg_newindia_policy_pdf',
  threadId: 'thread_newindia_nexon',
  from: 'New India Assurance <info@newindia.co.in>',
  to: 'pradhuldev.1990@gmail.com',
  subject: `New India Assurance - Premium Receipt & Policy document for ${NEW_INDIA_POLICY}`,
  snippet: `Please find attached the policy schedule and clause for policy ${NEW_INDIA_POLICY}.`,
  date: '2026-07-21T08:12:00.000Z',
  hasAttachment: true,
};

export const emailBSchedulePdf: GmailAttachmentMeta = {
  messageId: emailBHint.messageId,
  attachmentId: 'att_schedule_pdf',
  filename: 'Policy_Schedule_76110031260300010312.pdf',
  mimeType: 'application/pdf',
  size: 420_000,
  subject: emailBHint.subject,
  from: emailBHint.from,
  date: emailBHint.date,
  snippet: emailBHint.snippet,
};

export const emailBClausePdf: GmailAttachmentMeta = {
  messageId: emailBHint.messageId,
  attachmentId: 'att_clause_pdf',
  filename: 'Policy_Clause_76110031260300010312.pdf',
  mimeType: 'application/pdf',
  size: 180_000,
  subject: emailBHint.subject,
  from: emailBHint.from,
  date: emailBHint.date,
  snippet: emailBHint.snippet,
};

/** Mid-November lookback cutoff — July emails are older than ~90 days. */
export const LOOKBACK_AFTER_MID_NOV = '2026-08-21T00:00:00.000Z';
