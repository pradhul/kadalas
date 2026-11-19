export interface GmailAttachmentMeta {
  messageId: string;
  attachmentId: string;
  filename: string;
  mimeType: string;
  size: number;
  subject: string;
  from: string;
  date: string;
  snippet: string;
  /** Content-Disposition from the MIME part (e.g. inline / attachment). */
  contentDisposition?: string;
  /** Content-ID without angle brackets. */
  contentId?: string;
  /** True when HTML body references this part via cid:… */
  referencedAsCid?: boolean;
  isInline?: boolean;
}

export interface GmailAttachmentContent extends GmailAttachmentMeta {
  /** Base64url decoded as standard base64 for consumers */
  dataBase64: string;
}

export interface GmailSearchOptions {
  query: string;
  maxResults?: number;
  pageToken?: string | null;
}

export interface GmailSearchPage {
  attachments: GmailAttachmentMeta[];
  nextPageToken: string | null;
  /** Approximate total messages matching the query when available */
  estimatedTotal: number | null;
  messagesInPage: number;
}

export interface GmailMessageView {
  messageId: string;
  subject: string;
  from: string;
  date: string;
  /** Plain-text body when available. */
  textBody: string;
  /** Sanitized HTML suitable for a sandboxed iframe (remote images stripped). */
  htmlBody: string;
  snippet: string;
}

export interface GmailMessageHint {
  messageId: string;
  threadId?: string;
  subject: string;
  from: string;
  to?: string;
  date: string;
  snippet: string;
  hasAttachment: boolean;
}

export interface GmailService {
  searchMessagesWithAttachments(options: GmailSearchOptions): Promise<GmailAttachmentMeta[]>;
  /** Paginated search used by the resumable full-mailbox scan. */
  searchAttachmentsPage(options: GmailSearchOptions): Promise<GmailSearchPage>;
  /**
   * Metadata-only message list (may include messages without attachments).
   * Used to link policy/reg emails to the PDF-bearing message.
   */
  searchMessageHints?(options: GmailSearchOptions): Promise<{
    messages: GmailMessageHint[];
    nextPageToken: string | null;
  }>;
  /**
   * Download attachment bytes. Pass `knownMeta` from the scan index to avoid
   * re-fetching the full message for filename/subject/mime.
   */
  getAttachment(
    messageId: string,
    attachmentId: string,
    knownMeta?: Partial<GmailAttachmentMeta>,
  ): Promise<GmailAttachmentContent>;
  /** Full message for the review "View email" panel. */
  getMessageView?(messageId: string): Promise<GmailMessageView>;
}
