import { fetchWithTimeout } from '../../lib/fetchWithTimeout';
import { getAuthService } from '../auth';
import { sanitizeEmailHtml } from '../../lib/sanitizeEmailHtml';
import {
  GmailAttachmentContent,
  GmailAttachmentMeta,
  GmailMessageView,
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
  headers?: Array<{ name: string; value: string }>;
  body?: { attachmentId?: string; size?: number; data?: string };
  parts?: MessagePart[];
}

type ExtractedPart = {
  filename: string;
  mimeType: string;
  attachmentId: string;
  size: number;
  contentDisposition?: string;
  contentId?: string;
  isInline?: boolean;
};

function normalizeContentId(raw: string): string {
  return raw.replace(/^<|>$/g, '').trim();
}

function decodeBodyData(data?: string): string {
  if (!data) return '';
  try {
    const b64 = data.replace(/-/g, '+').replace(/_/g, '/');
    if (typeof atob === 'function') return atob(b64);
    const Buf = (globalThis as { Buffer?: { from: (s: string, enc: string) => { toString: (e: string) => string } } }).Buffer;
    if (Buf) return Buf.from(b64, 'base64').toString('utf8');
    return '';
  } catch {
    return '';
  }
}

function collectHtmlBodies(part: MessagePart, acc: string[]) {
  const mime = (part.mimeType || '').toLowerCase();
  if (mime === 'text/html' && part.body?.data) {
    acc.push(decodeBodyData(part.body.data));
  }
  for (const child of part.parts || []) collectHtmlBodies(child, acc);
}

function extractCidRefs(html: string): Set<string> {
  const refs = new Set<string>();
  const re = /cid:([^"'>\s]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    refs.add(normalizeContentId(m[1]));
  }
  return refs;
}

function walkParts(part: MessagePart, acc: ExtractedPart[]) {
  if (part.filename && part.body?.attachmentId) {
    const disposition = headerValue(part.headers, 'Content-Disposition');
    const contentId = normalizeContentId(headerValue(part.headers, 'Content-ID'));
    const isInline = /inline/i.test(disposition) || Boolean(contentId && !/attachment/i.test(disposition));
    acc.push({
      filename: part.filename,
      mimeType: part.mimeType || 'application/octet-stream',
      attachmentId: part.body.attachmentId,
      size: part.body.size || 0,
      contentDisposition: disposition || undefined,
      contentId: contentId || undefined,
      isInline,
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

  const attachments: ExtractedPart[] = [];
  if (detail.payload) walkParts(detail.payload, attachments);
  if (!attachments.length) return [];

  const htmlBodies: string[] = [];
  if (detail.payload) collectHtmlBodies(detail.payload, htmlBodies);
  const cidRefs = extractCidRefs(htmlBodies.join('\n'));

  const subject = headerValue(detail.payload?.headers, 'Subject');
  const from = headerValue(detail.payload?.headers, 'From');
  const dateHeader = headerValue(detail.payload?.headers, 'Date');
  const date = detail.internalDate
    ? new Date(Number(detail.internalDate)).toISOString()
    : new Date(dateHeader || Date.now()).toISOString();

  return attachments.map((att) => {
    const referencedAsCid = Boolean(att.contentId && cidRefs.has(att.contentId));
    return {
      messageId: detail.id,
      attachmentId: att.attachmentId,
      filename: att.filename,
      mimeType: att.mimeType,
      size: att.size,
      subject,
      from,
      date,
      snippet: detail.snippet || '',
      contentDisposition: att.contentDisposition,
      contentId: att.contentId,
      referencedAsCid,
      isInline: att.isInline || referencedAsCid,
    } satisfies GmailAttachmentMeta;
  });
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
        contentDisposition: knownMeta?.contentDisposition,
        contentId: knownMeta?.contentId,
        referencedAsCid: knownMeta?.referencedAsCid,
        isInline: knownMeta?.isInline,
        dataBase64,
      } satisfies GmailAttachmentContent;
    },

    async getMessageView(messageId: string): Promise<GmailMessageView> {
      const detailRes = await gmailFetch(`/users/me/messages/${messageId}?format=full`);
      const detail = (await detailRes.json()) as {
        id: string;
        snippet?: string;
        internalDate?: string;
        payload?: MessagePart & { headers?: Array<{ name: string; value: string }> };
      };
      const htmlBodies: string[] = [];
      const textBodies: string[] = [];
      const walkBody = (part: MessagePart) => {
        const mime = (part.mimeType || '').toLowerCase();
        if (mime === 'text/html' && part.body?.data) htmlBodies.push(decodeBodyData(part.body.data));
        if (mime === 'text/plain' && part.body?.data) textBodies.push(decodeBodyData(part.body.data));
        for (const child of part.parts || []) walkBody(child);
      };
      if (detail.payload) walkBody(detail.payload);
      const subject = headerValue(detail.payload?.headers, 'Subject');
      const from = headerValue(detail.payload?.headers, 'From');
      const dateHeader = headerValue(detail.payload?.headers, 'Date');
      const date = detail.internalDate
        ? new Date(Number(detail.internalDate)).toISOString()
        : new Date(dateHeader || Date.now()).toISOString();
      const textBody = textBodies.join('\n\n').trim();
      const htmlRaw = htmlBodies.join('\n');
      return {
        messageId: detail.id,
        subject,
        from,
        date,
        textBody,
        htmlBody: sanitizeEmailHtml(htmlRaw || (textBody ? `<pre>${textBody.replace(/</g, '&lt;')}</pre>` : '')),
        snippet: detail.snippet || '',
      };
    },
  };
}
