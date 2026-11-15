import { dedupeScanCandidates, findDuplicateInVault } from '../src/lib/dedup';
import { MOCK_VAULT_INDEX, MOCK_SCAN_CANDIDATES } from '../src/mocks/data';
import { ScanCandidate } from '../src/types/document';

describe('dedup', () => {
  it('detects duplicate by file hash', () => {
    const result = findDuplicateInVault(
      { hash: 'fnv1a-od-2026', title: 'copy' },
      MOCK_VAULT_INDEX.documents,
    );
    expect(result.isDuplicate).toBe(true);
    expect(result.duplicateOfId).toBe('doc_ka01_od');
  });

  it('detects duplicate by issuer + reference', () => {
    const result = findDuplicateInVault(
      {
        metadata: { issuer: 'Progressive', referenceNumber: 'PRG-7788' },
        title: 'Another Progressive OD packet',
      },
      MOCK_VAULT_INDEX.documents,
    );
    expect(result.isDuplicate).toBe(true);
  });

  it('dedupes a scan batch against vault and itself', () => {
    const bill = MOCK_SCAN_CANDIDATES.find((c) => c.classification?.category === 'Bills')!;
    const vehicle = MOCK_SCAN_CANDIDATES.find((c) => c.id === 'scan_ka01_od')!;
    const batch: ScanCandidate[] = [
      {
        ...bill,
        id: 'a',
        contentRef: 'same-hash',
        status: 'pending',
        classification: {
          category: 'Bills',
          title: 'Unique Water Bill',
          metadata: { issuer: 'Aqua Co', referenceNumber: 'WATER-999' },
          confidence: 0.9,
          isImportantDocument: true,
        },
      },
      {
        ...bill,
        id: 'b',
        contentRef: 'same-hash',
        status: 'pending',
        classification: {
          category: 'Bills',
          title: 'Unique Water Bill copy',
          metadata: { issuer: 'Aqua Co', referenceNumber: 'WATER-999' },
          confidence: 0.9,
          isImportantDocument: true,
        },
      },
      {
        ...vehicle,
        id: 'c',
        contentRef: 'unique-hash',
        status: 'pending',
        classification: {
          category: 'Insurance/Vehicle',
          title: 'Progressive Standalone OD',
          metadata: { issuer: 'Progressive', referenceNumber: 'PRG-7788' },
          confidence: 0.9,
          isImportantDocument: true,
        },
      },
    ];

    const result = dedupeScanCandidates(batch, MOCK_VAULT_INDEX.documents, (c) => c.contentRef);
    expect(result[0].status).toBe('pending');
    expect(result[1].status).toBe('duplicate');
    expect(result[2].status).toBe('duplicate');
  });
});
