import { getLargeMockMailbox, MockMailboxMessage } from '../../mocks/mailbox';
import { MOCK_SCAN_CANDIDATES } from '../../mocks/data';
import { GmailAttachmentContent, GmailAttachmentMeta, GmailSearchPage, GmailService } from './types';

function encodeBase64(value: string): string {
  if (typeof globalThis.btoa === 'function') return globalThis.btoa(value);
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
  let output = '';
  for (let i = 0; i < value.length; i += 3) {
    const a = value.charCodeAt(i);
    const b = i + 1 < value.length ? value.charCodeAt(i + 1) : NaN;
    const c = i + 2 < value.length ? value.charCodeAt(i + 2) : NaN;
    const bitmap = (a << 16) | ((Number.isNaN(b) ? 0 : b) << 8) | (Number.isNaN(c) ? 0 : c);
    output += chars.charAt((bitmap >> 18) & 63);
    output += chars.charAt((bitmap >> 12) & 63);
    output += Number.isNaN(b) ? '=' : chars.charAt((bitmap >> 6) & 63);
    output += Number.isNaN(c) ? '=' : chars.charAt(bitmap & 63);
  }
  return output;
}

function parseAfter(query: string): Date | null {
  const m = /after:(\d{4})\/(\d{2})\/(\d{2})/i.exec(query);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

function filterMailbox(query: string, mailbox: MockMailboxMessage[]): MockMailboxMessage[] {
  const q = query.toLowerCase();
  const after = parseAfter(query);

  return mailbox.filter((item) => {
    if (after && new Date(item.date).getTime() < after.getTime()) return false;
    if (q.includes('progressive') || q.includes('prg-7788') || q.includes('ka-01-ab-1234')) {
      const hay = `${item.subject} ${item.from} ${item.filename} ${item.snippet}`.toLowerCase();
      return (
        hay.includes('progressive') ||
        hay.includes('prg-7788') ||
        hay.includes('ka-01-ab-1234') ||
        hay.includes('digit')
      );
    }
    if (q.includes('has:attachment')) return true;
    return true;
  });
}

export function createMockGmailService(): GmailService {
  const mailbox = getLargeMockMailbox();

  // Keep short-list sync helpers from demo candidates at the front for sync tests
  const syncExtras: MockMailboxMessage[] = [
    ...MOCK_SCAN_CANDIDATES.map((c) => ({
      messageId: c.gmailMessageId,
      attachmentId: c.gmailAttachmentId,
      filename: c.fileName,
      mimeType: c.mimeType,
      size: c.sizeBytes,
      subject: c.subject,
      from: c.from,
      date: c.date,
      snippet: c.previewSnippet || '',
      bodyText: c.previewSnippet || c.fileName,
      kind: 'important' as const,
    })),
    {
      messageId: 'msg_sync_od_newer',
      attachmentId: 'att_sync_newer',
      filename: 'progressive-od-ka01ab1234-latest.pdf',
      mimeType: 'application/pdf',
      size: 270_000,
      subject: 'Progressive Standalone OD updated declarations — PRG-7788',
      from: 'Progressive <docs@progressive.com>',
      date: new Date().toISOString(),
      snippet: 'Standalone OD renewal packet for KA-01-AB-1234 policy PRG-7788.',
      bodyText:
        'Standalone OD Own Damage only vehicle insurance registration KA-01-AB-1234 policy PRG-7788 Progressive holder Pradhul Dev issue 2026-11-01 expiry 2027-10-31',
      kind: 'important',
    },
  ];

  const byId = new Map<string, MockMailboxMessage>();
  for (const row of [...syncExtras, ...mailbox]) {
    byId.set(`${row.messageId}::${row.attachmentId}`, row);
  }
  const all = [...byId.values()].sort((a, b) => b.date.localeCompare(a.date));

  function pageSearch(options: { query: string; maxResults?: number; pageToken?: string | null }): GmailSearchPage {
    const filtered = filterMailbox(options.query, all);
    const pageSize = options.maxResults ?? 50;
    const start = options.pageToken ? Number(options.pageToken) || 0 : 0;
    const slice = filtered.slice(start, start + pageSize);
    const next = start + pageSize < filtered.length ? String(start + pageSize) : null;

    // Unique messages in this page
    const msgIds = new Set(slice.map((s) => s.messageId));

    return {
      attachments: slice.map(({ bodyText: _b, kind: _k, ...meta }) => meta as GmailAttachmentMeta),
      nextPageToken: next,
      estimatedTotal: new Set(filtered.map((f) => f.messageId)).size,
      messagesInPage: msgIds.size,
    };
  }

  return {
    async searchMessagesWithAttachments(options) {
      const page = pageSearch({ ...options, pageToken: null });
      return page.attachments;
    },

    async searchAttachmentsPage(options) {
      return pageSearch(options);
    },

    async searchMessageHints(options) {
      const page = pageSearch(options);
      const seen = new Set<string>();
      const messages = [];
      for (const att of page.attachments) {
        if (seen.has(att.messageId)) continue;
        seen.add(att.messageId);
        messages.push({
          messageId: att.messageId,
          subject: att.subject,
          from: att.from,
          date: att.date,
          snippet: att.snippet,
          hasAttachment: true,
        });
      }
      return { messages, nextPageToken: page.nextPageToken };
    },

    async getAttachment(messageId, attachmentId) {
      const meta = byId.get(`${messageId}::${attachmentId}`);
      if (!meta) throw new Error('Mock attachment not found');
      const payload = `MOCK_PDF:${meta.filename}:${meta.bodyText}`;
      return {
        messageId: meta.messageId,
        attachmentId: meta.attachmentId,
        filename: meta.filename,
        mimeType: meta.mimeType,
        size: meta.size,
        subject: meta.subject,
        from: meta.from,
        date: meta.date,
        snippet: meta.snippet,
        dataBase64: encodeBase64(payload),
      };
    },

    async getMessageView(messageId: string) {
      const hit = [...byId.values()].find((m) => m.messageId === messageId);
      if (!hit) throw new Error('Mock message not found');
      const body = hit.bodyText || hit.snippet || 'Mock email body';
      return {
        messageId,
        subject: hit.subject,
        from: hit.from,
        date: hit.date,
        textBody: body,
        htmlBody: `<p>${body.replace(/</g, '&lt;')}</p>`,
        snippet: hit.snippet,
      };
    },
  };
}
