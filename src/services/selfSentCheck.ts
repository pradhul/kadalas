import { classifyWithRules } from '../lib/categorisation';
import {
  buildSelfSentQuery,
  isSelfSentKadalasMessage,
  parseKadalasTitleHint,
  selfSentDedupeKey,
} from '../lib/selfSentMail';
import { ScanCandidate, VaultDocument } from '../types/document';
import { getGmailService } from './gmail';
import { loadDeviceSettings, saveDeviceSettings } from './settingsPersist';

export type SelfSentCheckResult = {
  found: number;
  autoApproved: number;
  queuedForReview: number;
  skippedDuplicate: number;
  candidates: ScanCandidate[];
  checkedAt: string;
};

function alreadyInVault(docs: VaultDocument[], messageId: string, attachmentId: string): boolean {
  return docs.some((d) =>
    d.versions.some(
      (v) => v.gmailMessageId === messageId && v.gmailAttachmentId === attachmentId,
    ),
  );
}

/**
 * Lightweight self-sent document intake. Never deletes/trashes Gmail.
 * Tagged kadalas messages → high-trust auto-approve candidates.
 * Optional setting: any self-sent attachment → top-priority review.
 */
export async function runSelfSentCheck(input: {
  userEmail?: string | null;
  vaultDocuments: VaultDocument[];
  /** When provided, auto-approve path calls this for each new tagged attachment. */
  autoApprove?: (candidate: ScanCandidate) => Promise<void>;
  /** Queue untagged self-sent (setting on) into review instead of auto-approve. */
  enqueueReview?: (candidates: ScanCandidate[]) => Promise<void>;
}): Promise<SelfSentCheckResult> {
  const device = await loadDeviceSettings();
  const checkedAt = new Date().toISOString();
  const gmail = getGmailService();
  const query = buildSelfSentQuery(device.lastSelfSentCheckAt);
  const page = await gmail.searchAttachmentsPage({ query, maxResults: 40 });

  const autoCandidates: ScanCandidate[] = [];
  const reviewCandidates: ScanCandidate[] = [];
  let skippedDuplicate = 0;

  for (const att of page.attachments) {
    if (alreadyInVault(input.vaultDocuments, att.messageId, att.attachmentId)) {
      skippedDuplicate += 1;
      continue;
    }

    const tagged = isSelfSentKadalasMessage({
      from: att.from,
      subject: att.subject,
      snippetOrBody: att.snippet,
      userEmail: input.userEmail,
    });

    const titleHint = parseKadalasTitleHint(att.subject);
    const classified = classifyWithRules({
      fileName: att.filename,
      subject: titleHint || att.subject,
      from: att.from,
      textExcerpt: att.snippet,
    });
    if (titleHint) {
      classified.title = titleHint;
      classified.confidence = Math.max(classified.confidence, 0.92);
      classified.reason = 'Self-sent with kadalas tag — high trust';
    }

    const candidate: ScanCandidate = {
      id: selfSentDedupeKey(att.messageId, att.attachmentId),
      gmailMessageId: att.messageId,
      gmailAttachmentId: att.attachmentId,
      fileName: att.filename,
      mimeType: att.mimeType,
      sizeBytes: att.size,
      subject: att.subject,
      from: att.from,
      date: att.date,
      status: 'pending',
      previewSnippet: att.snippet,
      classification: classified,
      contentRef: `gmail:${att.messageId}:${att.attachmentId}`,
      isGroupLatest: true,
      addedByYou: tagged,
    };

    if (tagged) {
      autoCandidates.push(candidate);
    } else if (device.treatSelfSentAttachmentsAsDocuments) {
      // Untagged self-sent — only when setting is on; put at top of review
      reviewCandidates.push({
        ...candidate,
        reviewPriority: 100,
        classification: {
          ...classified,
          reason: 'Self-sent attachment (setting: treat as document)',
          confidence: Math.max(classified.confidence, 0.7),
        },
      });
    }
  }

  let autoApproved = 0;
  if (input.autoApprove) {
    for (const c of autoCandidates) {
      await input.autoApprove(c);
      autoApproved += 1;
    }
  }

  if (reviewCandidates.length && input.enqueueReview) {
    await input.enqueueReview(reviewCandidates);
  }

  await saveDeviceSettings({
    ...device,
    lastSelfSentCheckAt: checkedAt,
  });

  return {
    found: page.attachments.length,
    autoApproved,
    queuedForReview: reviewCandidates.length,
    skippedDuplicate,
    candidates: [...autoCandidates, ...reviewCandidates],
    checkedAt,
  };
}
