import { fetchWithTimeout } from '../../lib/fetchWithTimeout';
import { getAuthService } from '../auth';
import {
  GmailAttachmentContent,
  GmailAttachmentMeta,
  GmailSearchPage,
  GmailService,
} from './types';

const GMAIL = 'https://gmail.googleapis.com/gmail/v1';

async function gmailFetch(path: string, init: RequestInit = {}) {
  const token = await getAuthService().getValidAccessToken();
  const res = await fetchWithTimeout(`${GMAIL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`Gmail API ${res.status}: ${text}`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  return res;
}

function headerValue(headers: Array<{ name: string; value: string }> | undefined, name: string): string {
  return headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';
}

interface MessagePart {
  filename?: string;
  mimeType?: string;
  body?: { attachmentId?: string; size?: number; data?: string };
  parts?: MessagePart[];
}

function walkParts(
  part: MessagePart,
  acc: Array<{ filename: string; mimeType: string; attachmentId: string; size: number }>,
) {
  if (part.filename && part.body?.attachmentId) {
    acc.push({
      filename: part.filename,
      mimeType: part.mimeType || 'application/octet-stream',
      attachmentId: part.body.attachmentId,
      size: part.body.size || 0,
    });
  }
  for (const child of part.parts || []) walkParts(child, acc);
}

async function loadMessageAttachments(messageId: string): Promise<GmailAttachmentMeta[]> {
  const detailRes = await gmailFetch(`/users/me/messages/${messageId}?format=full`);
  const detail = (await detailRes.json()) as {
    id: string;
    snippet?: string;
    internalDate?: string;
    payload?: MessagePart & { headers?: Array<{ name: string; value: string }> };
  };

  const attachments: Array<{ filename: string; mimeType: string; attachmentId: string; size: number }> = [];
  if (detail.payload) walkParts(detail.payload, attachments);
  if (!attachments.length) return [];

  const subject = headerValue(detail.payload?.headers, 'Subject');
  const from = headerValue(detail.payload?.headers, 'From');
  const dateHeader = headerValue(detail.payload?.headers, 'Date');
  const date = detail.internalDate
    ? new Date(Number(detail.internalDate)).toISOString()
    : new Date(dateHeader || Date.now()).toISOString();

  return attachments.map((att) => ({
    messageId: detail.id,
    attachmentId: att.attachmentId,
    filename: att.filename,
    mimeType: att.mimeType,
    size: att.size,
    subject,
    from,
    date,
    snippet: detail.snippet || '',
  }));
}

export function createGoogleGmailService(): GmailService {
  return {
    async searchAttachmentsPage({ query, maxResults = 50, pageToken }): Promise<GmailSearchPage> {
      const params = new URLSearchParams({
        q: query,
        maxResults: String(maxResults),
      });
      if (pageToken) params.set('pageToken', pageToken);

      const listRes = await gmailFetch(`/users/me/messages?${params.toString()}`);
      const list = (await listRes.json()) as {
        messages?: Array<{ id: string }>;
        nextPageToken?: string;
        resultSizeEstimate?: number;
      };

      const attachments: GmailAttachmentMeta[] = [];
      for (const msg of list.messages || []) {
        const atts = await loadMessageAttachments(msg.id);
        attachments.push(...atts);
      }

      return {
        attachments,
        nextPageToken: list.nextPageToken ?? null,
        estimatedTotal: list.resultSizeEstimate ?? null,
        messagesInPage: list.messages?.length ?? 0,
      };
    },

    async searchMessagesWithAttachments(options) {
      const page = await this.searchAttachmentsPage({ ...options, pageToken: null });
      return page.attachments;
    },

    async getAttachment(messageId, attachmentId, knownMeta) {
      // Reuse scan-pipeline metadata — do not re-fetch format=full for every classify.
      const attRes = await gmailFetch(`/users/me/messages/${messageId}/attachments/${attachmentId}`);
      const att = (await attRes.json()) as { data: string; size?: number };
      const dataBase64 = att.data.replace(/-/g, '+').replace(/_/g, '/');

      return {
        messageId,
        attachmentId,
        filename: knownMeta?.filename || 'attachment',
        mimeType: knownMeta?.mimeType || 'application/octet-stream',
        size: att.size || knownMeta?.size || 0,
        subject: knownMeta?.subject || '',
        from: knownMeta?.from || '',
        date: knownMeta?.date || new Date().toISOString(),
        snippet: knownMeta?.snippet || '',
        dataBase64,
      } satisfies GmailAttachmentContent;
    },
  };
}
