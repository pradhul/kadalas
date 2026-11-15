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

export interface GmailService {
  searchMessagesWithAttachments(options: GmailSearchOptions): Promise<GmailAttachmentMeta[]>;
  /** Paginated search used by the resumable full-mailbox scan. */
  searchAttachmentsPage(options: GmailSearchOptions): Promise<GmailSearchPage>;
  /**
   * Download attachment bytes. Pass `knownMeta` from the scan index to avoid
   * re-fetching the full message for filename/subject/mime.
   */
  getAttachment(
    messageId: string,
    attachmentId: string,
    knownMeta?: Partial<GmailAttachmentMeta>,
  ): Promise<GmailAttachmentContent>;
}
