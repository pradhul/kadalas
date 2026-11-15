import { MOCK_SCAN_CANDIDATES } from '../../mocks/data';
import { GmailAttachmentContent, GmailAttachmentMeta, GmailService } from './types';

function encodeBase64(value: string): string {
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

export function createMockGmailService(): GmailService {
  const catalog: GmailAttachmentMeta[] = MOCK_SCAN_CANDIDATES.map((c) => ({
    messageId: c.gmailMessageId,
    attachmentId: c.gmailAttachmentId,
    filename: c.fileName,
    mimeType: c.mimeType,
    size: c.sizeBytes,
    subject: c.subject,
    from: c.from,
    date: c.date,
    snippet: c.previewSnippet || '',
  }));

  // Extra "newer version" hit for vehicle sync demos
  catalog.push({
    messageId: 'msg_sync_geico_newer',
    attachmentId: 'att_sync_newer',
    filename: 'geico-policy-latest.pdf',
    mimeType: 'application/pdf',
    size: 270_000,
    subject: 'Updated GEICO declarations page — POL-88421-VA',
    from: 'GEICO <documents@geico.com>',
    date: new Date().toISOString(),
    snippet: 'Attached is your updated policy declarations for POL-88421-VA.',
  });

  return {
    async searchMessagesWithAttachments({ query, maxResults = 25 }) {
      const q = query.toLowerCase();
      const filtered = catalog.filter((item) => {
        if (q.includes('after:')) {
          // Keep simple: mock ignores precise after filtering beyond returning recent items
        }
        const hay = `${item.subject} ${item.from} ${item.filename} ${item.snippet}`.toLowerCase();
        if (q.includes('geico') || q.includes('pol-88421')) {
          return hay.includes('geico') || hay.includes('pol-88421');
        }
        if (q.includes('has:attachment')) return true;
        return hay.includes(q.slice(0, 12));
      });
      return filtered.slice(0, maxResults);
    },

    async getAttachment(messageId, attachmentId) {
      const meta = catalog.find((c) => c.messageId === messageId && c.attachmentId === attachmentId);
      if (!meta) throw new Error('Mock attachment not found');
      const payload = `MOCK_PDF_CONTENT:${meta.filename}:${meta.messageId}`;
      const dataBase64 =
        typeof globalThis.btoa === 'function'
          ? globalThis.btoa(payload)
          : encodeBase64(payload);
      return { ...meta, dataBase64 } satisfies GmailAttachmentContent;
    },
  };
}
