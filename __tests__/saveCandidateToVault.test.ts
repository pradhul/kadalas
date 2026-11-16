const uploadFile = jest.fn();
const getFolderIdForCategory = jest.fn();
const upsertDocument = jest.fn();
const getAttachment = jest.fn();

jest.mock('../src/services/config', () => ({
  useMocks: () => true,
}));

jest.mock('../src/services/drive', () => ({
  getDriveService: () => ({
    getFolderIdForCategory,
    uploadFile,
    upsertDocument,
  }),
}));

jest.mock('../src/services/gmail', () => ({
  getGmailService: () => ({
    getAttachment,
  }),
}));

jest.mock('../src/services/ai', () => ({
  getAiService: () => ({}),
}));

import { saveCandidateToVault } from '../src/services/vaultOps';
import { ScanCandidate } from '../src/types/document';

function candidate(): ScanCandidate {
  return {
    id: 'c1',
    gmailMessageId: 'msg1',
    gmailAttachmentId: 'att1',
    subject: 'Health policy',
    from: 'insurer@x.com',
    date: '2026-01-01T00:00:00.000Z',
    fileName: 'policy.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 100,
    status: 'pending',
    classification: {
      category: 'Insurance/Health',
      title: 'MediAssist policy',
      metadata: { issuer: 'Medi Assist', documentType: 'Policy' },
      confidence: 0.9,
      isImportantDocument: true,
    },
  };
}

describe('saveCandidateToVault', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getFolderIdForCategory.mockResolvedValue('folder_health_id');
    getAttachment.mockResolvedValue({
      messageId: 'msg1',
      attachmentId: 'att1',
      filename: 'policy.pdf',
      mimeType: 'application/pdf',
      size: 100,
      subject: 'Health policy',
      from: 'insurer@x.com',
      date: '2026-01-01T00:00:00.000Z',
      snippet: '',
      dataBase64: Buffer.from('%PDF-fake').toString('base64'),
    });
    uploadFile.mockResolvedValue({
      id: 'file_abc',
      name: 'MediAssist policy.pdf',
      mimeType: 'application/pdf',
      webViewLink: 'https://drive.google.com/file/d/file_abc/view',
    });
    upsertDocument.mockImplementation(async (doc: unknown) => doc);
  });

  it('uploads into the category folder parent and returns the Drive file id', async () => {
    const result = await saveCandidateToVault(candidate());
    expect(getFolderIdForCategory).toHaveBeenCalledWith('Insurance/Health');
    expect(uploadFile).toHaveBeenCalledWith(
      expect.objectContaining({
        parentFolderId: 'folder_health_id',
        mimeType: 'application/pdf',
        contentBase64: expect.any(String),
      }),
    );
    expect(result.driveFileId).toBe('file_abc');
    expect(result.webViewLink).toContain('file_abc');
    expect(result.parentFolderId).toBe('folder_health_id');
    expect(result.category).toBe('Insurance/Health');
  });

  it('throws when Gmail attachment download fails (no silent placeholder)', async () => {
    getAttachment.mockRejectedValue(new Error('Gmail 404'));
    await expect(saveCandidateToVault(candidate())).rejects.toThrow(/Gmail 404/);
    expect(uploadFile).not.toHaveBeenCalled();
  });

  it('throws when Drive upload returns no file id', async () => {
    uploadFile.mockResolvedValue({ name: 'x.pdf', mimeType: 'application/pdf' });
    await expect(saveCandidateToVault(candidate())).rejects.toThrow(/no file id/i);
  });
});
