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
}

export interface GmailService {
  searchMessagesWithAttachments(options: GmailSearchOptions): Promise<GmailAttachmentMeta[]>;
  getAttachment(messageId: string, attachmentId: string): Promise<GmailAttachmentContent>;
}
