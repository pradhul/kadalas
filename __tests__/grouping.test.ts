import { groupCandidatesBySubject, selectLatestInGroup } from '../src/lib/grouping';
import { ScanCandidate } from '../src/types/document';

function candidate(
  id: string,
  opts: {
    coverageType: string;
    issuer: string;
    reg: string;
    start: string;
    end: string;
    date?: string;
  },
): ScanCandidate {
  return {
    id,
    gmailMessageId: `msg_${id}`,
    gmailAttachmentId: `att_${id}`,
    subject: `${opts.issuer} ${opts.coverageType} ${opts.reg}`,
    from: `${opts.issuer} <docs@example.com>`,
    date: opts.date ?? opts.start,
    fileName: `${id}.pdf`,
    mimeType: 'application/pdf',
    sizeBytes: 1000,
    status: 'pending',
    classification: {
      category: 'Insurance/Vehicle',
      title: `${opts.issuer} ${opts.coverageType}`,
      metadata: {
        issuer: opts.issuer,
        documentType: opts.coverageType,
        coverageType: opts.coverageType,
        registrationNumber: opts.reg,
        issueDate: opts.start,
        expiryDate: opts.end,
        policyStartDate: opts.start,
      },
      confidence: 0.9,
      isImportantDocument: true,
    },
  };
}

describe('groupCandidatesBySubject', () => {
  it('keeps both OD and TP as current for the same registration', () => {
    const { groups } = groupCandidatesBySubject([
      candidate('od', {
        coverageType: 'Standalone OD',
        issuer: 'Progressive',
        reg: 'KA-01-AB-1234',
        start: '2026-02-18',
        end: '2027-02-17',
      }),
      candidate('tp', {
        coverageType: 'Liability Only',
        issuer: 'Go Digit',
        reg: 'KA-01-AB-1234',
        start: '2025-02-15',
        end: '2030-02-14',
      }),
      candidate('old_comp', {
        coverageType: 'Package Policy',
        issuer: 'GEICO',
        reg: 'KA-01-AB-1234',
        start: '2024-02-12',
        end: '2025-02-11',
      }),
    ]);

    expect(groups).toHaveLength(1);
    const g = groups[0];
    expect(g.currentDocs.map((c) => c.id).sort()).toEqual(['od', 'tp']);
    expect(g.older.map((c) => c.id)).toContain('old_comp');
    expect(g.summary).toMatch(/3 versions found, keeping/);
    expect(g.coverageSummary).toMatch(/Progressive/);
    expect(g.coverageSummary).toMatch(/Go Digit/);
  });

  it('groups insurer switch under one subject and marks older comprehensive superseded', () => {
    const { groups } = groupCandidatesBySubject([
      candidate('sf', {
        coverageType: 'Package Policy',
        issuer: 'State Farm',
        reg: 'MH-12-XY-9876',
        start: '2025-05-05',
        end: '2026-05-04',
      }),
      candidate('as', {
        coverageType: 'Comprehensive',
        issuer: 'Allstate',
        reg: 'MH-12-XY-9876',
        start: '2026-05-06',
        end: '2027-05-05',
      }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].currentDocs).toHaveLength(1);
    expect(groups[0].currentDocs[0].id).toBe('as');
    expect(groups[0].older[0].id).toBe('sf');
  });

  it('selectLatestInGroup returns multiple currentDocs for OD+TP', () => {
    const members = [
      candidate('od', {
        coverageType: 'OD only',
        issuer: 'Progressive',
        reg: 'KA-01-AB-1234',
        start: '2026-02-18',
        end: '2027-02-17',
      }),
      candidate('tp', {
        coverageType: 'Act Only',
        issuer: 'Go Digit',
        reg: 'KA-01-AB-1234',
        start: '2025-02-15',
        end: '2030-02-14',
      }),
    ];
    const result = selectLatestInGroup(members);
    expect(result.currentDocs).toHaveLength(2);
  });
});
