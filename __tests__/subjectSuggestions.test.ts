import {
  buildVehicleSubjectSuggestions,
  dedupeScanCandidates,
  formatSubjectSuggestionLabel,
  isDemoVehicleSubjectKey,
  isIdentifierGroundedInText,
  sanitizeMetadataAgainstText,
} from '../src/lib/subjectSuggestions';
import { enrichCandidateWithSubject } from '../src/lib/grouping';
import { rekeyDemoVehicleSubjects } from '../src/lib/rekeyDemoSubjects';
import { ScanCandidate, VaultDocument, VaultIndex } from '../src/types/document';

describe('subjectSuggestions — demo plate leak prevention', () => {
  it('recognises demo vehicle subject keys', () => {
    expect(isDemoVehicleSubjectKey('vehicle:reg:KA01AB1234')).toBe(true);
    expect(isDemoVehicleSubjectKey('vehicle:reg:MH12XY9876')).toBe(true);
    expect(isDemoVehicleSubjectKey('vehicle:reg:KA05MN4321')).toBe(false);
  });

  it('strips ungrounded and demo plates from metadata in real mode', () => {
    const text = 'Bank of Baroda statement for Pradhul Dev KP';
    const cleaned = sanitizeMetadataAgainstText(
      {
        registrationNumber: 'KA01AB1234',
        issuer: 'Bank of Baroda',
        holderName: 'Pradhul Dev KP',
      },
      text,
      { allowDemoPlates: false },
    );
    expect(cleaned.registrationNumber).toBeUndefined();
    expect(cleaned.issuer).toBe('Bank of Baroda');
  });

  it('keeps a plate that is grounded in document text (non-demo)', () => {
    const text = 'Motor policy for KA-05-MN-4321 Honda City';
    const cleaned = sanitizeMetadataAgainstText(
      { registrationNumber: 'KA05MN4321' },
      text,
      { allowDemoPlates: false },
    );
    expect(cleaned.registrationNumber).toBe('KA05MN4321');
  });

  it('grounds identifiers by compact match', () => {
    expect(isIdentifierGroundedInText('KA-05-MN-4321', 'Policy KA05MN4321')).toBe(true);
    expect(isIdentifierGroundedInText('KA05MN4321', 'Bank statement')).toBe(false);
  });

  it('never injects demo plates into possibleSubjectKeys for banking docs', () => {
    const banking: ScanCandidate = {
      id: 'b1',
      gmailMessageId: 'm1',
      gmailAttachmentId: 'a1',
      subject: 'Bank of Baroda statement',
      from: 'bob@bank.com',
      date: '2026-01-01T00:00:00.000Z',
      fileName: '19XXXXX616.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1,
      status: 'pending',
      classification: {
        category: 'Banking',
        title: 'Bank statement',
        metadata: {
          issuer: 'Bank of Baroda',
          documentType: 'BankStatement',
          // AI hallucination
          registrationNumber: 'KA01AB1234',
        },
        confidence: 0.8,
        isImportantDocument: true,
      },
    };
    const enriched = enrichCandidateWithSubject(banking, { allowDemoPlates: false });
    expect(enriched.classification?.metadata.registrationNumber).toBeUndefined();
    expect(enriched.possibleSubjectKeys).toBeUndefined();
    expect(enriched.status).toBe('pending');
    expect(JSON.stringify(enriched)).not.toMatch(/KA01AB1234|MH12XY9876/);
  });

  it('only offers vault vehicle subjects + grounded plate for vehicle docs', () => {
    const vaultDocs: VaultDocument[] = [
      {
        id: 'v1',
        title: 'My car',
        category: 'Insurance/Vehicle',
        driveFolderPath: 'Insurance/Vehicle',
        currentVersionId: 'ver1',
        versions: [],
        tags: [],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        metadata: {
          subjectKey: 'vehicle:reg:KA05MN4321',
          subjectLabel: 'KA-05-MN-4321',
          registrationNumber: 'KA-05-MN-4321',
        },
      },
    ];
    const suggestions = buildVehicleSubjectSuggestions({
      metadata: { registrationNumber: 'TN09AB7788' },
      groundingText: 'Policy for TN09AB7788',
      vaultDocuments: vaultDocs,
      allowDemoPlates: false,
    });
    expect(suggestions.map((s) => s.key)).toEqual([
      'vehicle:reg:KA05MN4321',
      'vehicle:reg:TN09AB7788',
    ]);
    expect(suggestions.every((s) => !isDemoVehicleSubjectKey(s.key))).toBe(true);
  });

  it('formats friendly labels — never raw vehicle:reg or weak keys', () => {
    expect(formatSubjectSuggestionLabel('vehicle:reg:KA05MN4321')).toMatch(/New vehicle:/);
    expect(
      formatSubjectSuggestionLabel('vehicle:reg:KA05MN4321', [
        {
          id: 'v1',
          title: 'x',
          category: 'Insurance/Vehicle',
          driveFolderPath: 'Insurance/Vehicle',
          currentVersionId: 'ver',
          versions: [],
          tags: [],
          createdAt: '',
          updatedAt: '',
          metadata: { subjectKey: 'vehicle:reg:KA05MN4321' },
        },
      ]),
    ).toMatch(/Link to vehicle/);
    expect(formatSubjectSuggestionLabel('weak:BANKOFBARODA:PRADHULDEVKP:account_statement')).toMatch(
      /Add to:/,
    );
    expect(formatSubjectSuggestionLabel('weak:BANKOFBARODA:PRADHULDEVKP:account_statement')).not.toMatch(
      /^weak:/,
    );
  });

  it('dedupes by gmail messageId + attachmentId', () => {
    const a: ScanCandidate = {
      id: '1',
      gmailMessageId: 'msg',
      gmailAttachmentId: 'att',
      subject: 'A',
      from: 'x',
      date: '2026-01-01T00:00:00.000Z',
      fileName: '19XXXXX616.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1,
      status: 'pending',
    };
    const b: ScanCandidate = { ...a, id: '2', status: 'skipped' };
    const out = dedupeScanCandidates([a, b]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('1');
  });

  it('dedupes by content hash when present', () => {
    const a: ScanCandidate = {
      id: '1',
      gmailMessageId: 'm1',
      gmailAttachmentId: 'a1',
      subject: 'A',
      from: 'x',
      date: '2026-01-01T00:00:00.000Z',
      fileName: 'f.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1,
      status: 'pending',
      contentRef: 'hash123',
    };
    const b: ScanCandidate = {
      ...a,
      id: '2',
      gmailMessageId: 'm2',
      gmailAttachmentId: 'a2',
      status: 'skipped',
    };
    expect(dedupeScanCandidates([a, b])).toHaveLength(1);
  });
});

describe('rekeyDemoVehicleSubjects', () => {
  function indexWith(docs: VaultDocument[]): VaultIndex {
    return {
      version: 1,
      vaultFolderId: 'root',
      lastScanAt: null,
      documents: docs,
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
  }

  const bankDoc = (): VaultDocument => ({
    id: 'd1',
    title: 'Bank stmt',
    category: 'Banking',
    driveFolderPath: 'Banking',
    currentVersionId: 'ver1',
    versions: [
      {
        id: 'ver1',
        driveFileId: 'file1',
        fileName: 'stmt.pdf',
        mimeType: 'application/pdf',
        hash: 'h',
        sizeBytes: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        source: 'gmail',
      },
    ],
    tags: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    metadata: {
      subjectKey: 'vehicle:reg:KA01AB1234',
      registrationNumber: 'KA01AB1234',
      issuer: 'Bank of Baroda',
      holderName: 'Pradhul Dev KP',
      documentType: 'BankStatement',
      coverageType: 'unknown',
    },
  });

  it('skips mock vaults', () => {
    const result = rekeyDemoVehicleSubjects(indexWith([bankDoc()]), true);
    expect(result.changed).toBe(false);
    expect(result.index.documents[0].metadata.subjectKey).toBe('vehicle:reg:KA01AB1234');
  });

  it('re-keys fake demo plates on real vaults without deleting docs', () => {
    const result = rekeyDemoVehicleSubjects(indexWith([bankDoc()]), false);
    expect(result.changed).toBe(true);
    expect(result.rekeyedIds).toEqual(['d1']);
    expect(result.index.documents[0].versions[0].driveFileId).toBe('file1');
    expect(result.index.documents[0].metadata.registrationNumber).toBeUndefined();
    expect(result.index.documents[0].metadata.subjectKey).not.toMatch(/vehicle:reg:KA01/);
    expect(result.index.documents[0].metadata.coverageType).toBeUndefined();
  });
});

describe('enrichCandidateWithSubject — Approve always available', () => {
  it('keeps vehicle docs without vault plates as pending (not chip-only)', () => {
    const raw: ScanCandidate = {
      id: 'amb',
      gmailMessageId: 'm',
      gmailAttachmentId: 'a',
      subject: 'Motor policy',
      from: 'x@y.com',
      date: '2026-01-01T00:00:00.000Z',
      fileName: 'unclear.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1,
      status: 'pending',
      classification: {
        category: 'Insurance/Vehicle',
        title: 'Motor policy',
        metadata: {
          holderName: 'Pradhul Dev',
          vehicleMakeModel: 'Honda City',
          documentType: 'Package Policy',
        },
        confidence: 0.7,
        isImportantDocument: true,
      },
    };
    const enriched = enrichCandidateWithSubject(raw, { allowDemoPlates: false });
    expect(enriched.subjectAmbiguous).toBe(true);
    expect(enriched.status).toBe('pending');
    expect(enriched.possibleSubjectKeys ?? []).toHaveLength(0);
    expect(JSON.stringify(enriched)).not.toMatch(/KA01AB1234|MH12XY9876/);
  });

  it('hides Unknown cover metadata for non-vehicle categories', () => {
    const health: ScanCandidate = {
      id: 'h1',
      gmailMessageId: 'm',
      gmailAttachmentId: 'a',
      subject: 'Mediassist',
      from: 'x',
      date: '2026-01-01T00:00:00.000Z',
      fileName: 'Mediassist_insurance.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1,
      status: 'pending',
      classification: {
        category: 'Insurance/Health',
        title: 'Health policy',
        metadata: {
          issuer: 'Aditya Birla Capital / Medi Assist TPA',
          documentType: 'Health policy',
          coverageType: 'unknown',
          referenceNumber: '4075193040',
          expiryDate: '2027-03-30',
          registrationNumber: 'MH12XY9876',
        },
        confidence: 0.9,
        isImportantDocument: true,
      },
    };
    const enriched = enrichCandidateWithSubject(health, { allowDemoPlates: false });
    expect(enriched.classification?.metadata.coverageType).toBeUndefined();
    expect(enriched.classification?.metadata.registrationNumber).toBeUndefined();
    expect(enriched.possibleSubjectKeys).toBeUndefined();
    expect(enriched.status).toBe('pending');
  });
});
