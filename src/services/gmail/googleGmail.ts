import { getAuthService } from '../auth';
import { GmailAttachmentContent, GmailAttachmentMeta, GmailService } from './types';

const GMAIL = 'https://gmail.googleapis.com/gmail/v1';

async function gmailFetch(path: string, init: RequestInit = {}) {
  const token = await getAuthService().getValidAccessToken();
  const res = await fetch(`${GMAIL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gmail API ${res.status}: ${text}`);
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

function walkParts(part: MessagePart, acc: Array<{ filename: string; mimeType: string; attachmentId: string; size: number }>) {
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

export function createGoogleGmailService(): GmailService {
  return {
    async searchMessagesWithAttachments({ query, maxResults = 25 }) {
      const listRes = await gmailFetch(
        `/users/me/messages?q=${encodeURIComponent(query)}&maxResults=${maxResults}`,
      );
      const list = (await listRes.json()) as { messages?: Array<{ id: string }> };
      const results: GmailAttachmentMeta[] = [];

      for (const msg of list.messages || []) {
        const detailRes = await gmailFetch(
          `/users/me/messages/${msg.id}?format=full`,
        );
        const detail = (await detailRes.json()) as {
          id: string;
          snippet?: string;
          internalDate?: string;
          payload?: MessagePart & { headers?: Array<{ name: string; value: string }> };
        };

        const attachments: Array<{ filename: string; mimeType: string; attachmentId: string; size: number }> = [];
        if (detail.payload) walkParts(detail.payload, attachments);
        if (!attachments.length) continue;

        const subject = headerValue(detail.payload?.headers, 'Subject');
        const from = headerValue(detail.payload?.headers, 'From');
        const dateHeader = headerValue(detail.payload?.headers, 'Date');
        const date = detail.internalDate
          ? new Date(Number(detail.internalDate)).toISOString()
          : new Date(dateHeader || Date.now()).toISOString();

        for (const att of attachments) {
          results.push({
            messageId: detail.id,
            attachmentId: att.attachmentId,
            filename: att.filename,
            mimeType: att.mimeType,
            size: att.size,
            subject,
            from,
            date,
            snippet: detail.snippet || '',
          });
        }
      }

      return results;
    },

    async getAttachment(messageId, attachmentId) {
      const metaList = await this.searchMessagesWithAttachments({
        query: `rfc822msgid:${messageId}`,
        maxResults: 1,
      });
      // Fallback metadata fetch
      const detailRes = await gmailFetch(`/users/me/messages/${messageId}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`);
      const detail = (await detailRes.json()) as {
        id: string;
        snippet?: string;
        internalDate?: string;
        payload?: { headers?: Array<{ name: string; value: string }> };
      };

      const attRes = await gmailFetch(`/users/me/messages/${messageId}/attachments/${attachmentId}`);
      const att = (await attRes.json()) as { data: string; size?: number };

      // Gmail returns base64url
      const dataBase64 = att.data.replace(/-/g, '+').replace(/_/g, '/');

      const subject = headerValue(detail.payload?.headers, 'Subject');
      const from = headerValue(detail.payload?.headers, 'From');
      const date = detail.internalDate
        ? new Date(Number(detail.internalDate)).toISOString()
        : new Date().toISOString();

      const known = metaList[0];
      return {
        messageId,
        attachmentId,
        filename: known?.filename || 'attachment',
        mimeType: known?.mimeType || 'application/octet-stream',
        size: att.size || known?.size || 0,
        subject,
        from,
        date,
        snippet: detail.snippet || '',
        dataBase64,
      } satisfies GmailAttachmentContent;
    },
  };
}
