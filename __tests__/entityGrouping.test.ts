import {
  enrichCandidateWithSubject,
  groupCandidatesBySubject,
} from '../src/lib/grouping';
import { MOCK_SCAN_CANDIDATES } from '../src/mocks/data';
import { ScanCandidate } from '../src/types/document';

function yearComp(year: number, insurer: string): ScanCandidate {
  return {
    id: `y${year}`,
    gmailMessageId: `m${year}`,
    gmailAttachmentId: `a${year}`,
    subject: `${insurer} Package ${year} RJ-14-CD-9999`,
    from: `${insurer} <x@y.com>`,
    date: `${year}-05-06T00:00:00.000Z`,
    fileName: `p-${year}.pdf`,
    mimeType: 'application/pdf',
    sizeBytes: 1,
    status: 'pending',
    classification: {
      category: 'Insurance/Vehicle',
      title: `${insurer} ${year}`,
      metadata: {
        issuer: insurer,
        documentType: 'Package Policy',
        coverageType: 'comprehensive',
        registrationNumber: 'RJ-14-CD-9999',
        issueDate: `${year}-05-06`,
        expiryDate: `${year + 1}-05-05`,
        policyStartDate: `${year}-05-06`,
      },
      confidence: 0.9,
      isImportantDocument: true,
    },
  };
}

describe('entity-aware grouping', () => {
  it('keeps only the latest of 4 versions and summarizes keeping 2026-27 policy', () => {
    const { groups, flat } = groupCandidatesBySubject([
      yearComp(2023, 'ICICI Lombard'),
      yearComp(2024, 'HDFC Ergo'),
      yearComp(2025, 'Bajaj Allianz'),
      yearComp(2026, 'Bajaj Allianz'),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].summary).toBe(
      'RJ-14-CD-9999: 4 versions found, keeping 2026-27 policy',
    );
    expect(groups[0].currentDocs).toHaveLength(1);
    expect(groups[0].currentDocs[0].id).toBe('y2026');
    expect(groups[0].older).toHaveLength(3);
    expect(flat.filter((c) => c.status === 'duplicate')).toHaveLength(3);
    expect(flat.find((c) => c.id === 'y2026')?.isGroupLatest).toBe(true);
  });

  it('groups insurer switch under one subject key (not policy number)', () => {
    const { groups } = groupCandidatesBySubject([
      yearComp(2025, 'State Farm'),
      yearComp(2026, 'Allstate'),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].subjectKey).toBe('vehicle:reg:RJ14CD9999');
    expect(groups[0].currentDocs[0].classification?.metadata.issuer).toBe('Allstate');
    expect(groups[0].older[0].classification?.metadata.issuer).toBe('State Farm');
  });

  it('flags ambiguous vehicle docs without registration; stays approveable (no demo chips)', () => {
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

  it('demo mock batch produces DL-01 group with 4 versions summary', () => {
    const { groups } = groupCandidatesBySubject(
      MOCK_SCAN_CANDIDATES.filter((c) => c.status !== 'skipped'),
      { allowDemoPlates: true },
    );
    const dl = groups.find((g) => g.subjectLabel === 'DL-01-CD-4321');
    expect(dl).toBeTruthy();
    expect(dl!.summary).toMatch(/4 versions found, keeping 2026-27 policy/);
    expect(dl!.older).toHaveLength(3);
  });
});
