import {
  createInitialDocument,
  findExpiringSoon,
  getCurrentVersion,
  listVersionHistory,
  promoteVersion,
} from '../src/lib/versioning';

describe('versioning', () => {
  it('creates a document with an initial current version', () => {
    const doc = createInitialDocument({
      title: 'Test',
      category: 'Tax',
      metadata: { issuer: 'IRS' },
      driveFolderPath: 'Tax',
      version: {
        driveFileId: 'f1',
        fileName: 'w2.pdf',
        mimeType: 'application/pdf',
        hash: 'h1',
        sizeBytes: 10,
        createdAt: '2026-01-01T00:00:00.000Z',
        source: 'upload',
      },
      nowIso: '2026-01-01T00:00:00.000Z',
    });
    expect(getCurrentVersion(doc)?.driveFileId).toBe('f1');
    expect(doc.versions).toHaveLength(1);
  });

  it('promotes a new version and keeps history', () => {
    const doc = createInitialDocument({
      id: 'd1',
      title: 'Policy',
      category: 'Insurance/Vehicle',
      metadata: {},
      driveFolderPath: 'Insurance/Vehicle',
      version: {
        id: 'v1',
        driveFileId: 'old',
        fileName: 'old.pdf',
        mimeType: 'application/pdf',
        hash: 'a',
        sizeBytes: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        source: 'gmail',
      },
    });
    const next = promoteVersion(doc, {
      driveFileId: 'new',
      fileName: 'new.pdf',
      mimeType: 'application/pdf',
      hash: 'b',
      sizeBytes: 2,
      createdAt: '2026-02-01T00:00:00.000Z',
      source: 'sync',
    });
    expect(next.versions).toHaveLength(2);
    expect(getCurrentVersion(next)?.driveFileId).toBe('new');
    expect(listVersionHistory(next)[0].driveFileId).toBe('new');
  });

  it('finds expiring documents within window including overdue', () => {
    const docs = [
      createInitialDocument({
        title: 'Soon',
        category: 'Warranties',
        metadata: { expiryDate: '2026-11-20' },
        driveFolderPath: 'Warranties',
        version: {
          driveFileId: '1',
          fileName: 'a.pdf',
          mimeType: 'application/pdf',
          hash: 'x',
          sizeBytes: 1,
          createdAt: '2026-01-01T00:00:00.000Z',
          source: 'upload',
        },
      }),
      createInitialDocument({
        title: 'Later',
        category: 'Identity',
        metadata: { expiryDate: '2027-11-20' },
        driveFolderPath: 'Identity',
        version: {
          driveFileId: '2',
          fileName: 'b.pdf',
          mimeType: 'application/pdf',
          hash: 'y',
          sizeBytes: 1,
          createdAt: '2026-01-01T00:00:00.000Z',
          source: 'upload',
        },
      }),
    ];

    const hits = findExpiringSoon(docs, 30, new Date('2026-11-15T00:00:00.000Z'));
    expect(hits).toHaveLength(1);
    expect(hits[0].document.title).toBe('Soon');
    expect(hits[0].daysLeft).toBe(5);
  });
});
