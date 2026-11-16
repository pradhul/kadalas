import { candidateMatchesQuery, filterCandidatesByQuery } from '../src/lib/reviewSearch';
import { ScanCandidate } from '../src/types/document';

function cand(partial: Partial<ScanCandidate> & Pick<ScanCandidate, 'id'>): ScanCandidate {
  return {
    id: partial.id,
    gmailMessageId: 'm',
    gmailAttachmentId: 'a',
    fileName: partial.fileName ?? 'file.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1,
    subject: partial.subject ?? '',
    from: partial.from ?? '',
    date: '2026-01-01T00:00:00Z',
    status: partial.status ?? 'pending',
    ...partial,
  };
}

describe('reviewSearch', () => {
  it('matches filename, subject, sender, category, AI summary (case-insensitive)', () => {
    const c = cand({
      id: '1',
      fileName: 'Form16.pdf',
      subject: 'Your Form 16 is ready',
      from: 'hr@acme.com',
      classification: { category: 'Tax', title: 'Form 16', metadata: {}, confidence: 0.9, isImportantDocument: true },
      aiDetail: {
        summary: 'Annual tax certificate from employer',
        confidence: 0.8,
        requestedAt: '2026-01-01T00:00:00Z',
      },
    });
    expect(candidateMatchesQuery(c, 'form16')).toBe(true);
    expect(candidateMatchesQuery(c, 'ACME')).toBe(true);
    expect(candidateMatchesQuery(c, 'tax')).toBe(true);
    expect(candidateMatchesQuery(c, 'certificate')).toBe(true);
    expect(candidateMatchesQuery(c, 'nomatch')).toBe(false);
  });

  it('filters a list; empty query returns all', () => {
    const list = [
      cand({ id: '1', fileName: 'bank.pdf', subject: 'Statement' }),
      cand({ id: '2', fileName: 'policy.pdf', subject: 'Insurance' }),
    ];
    expect(filterCandidatesByQuery(list, '')).toHaveLength(2);
    expect(filterCandidatesByQuery(list, 'insurance').map((c) => c.id)).toEqual(['2']);
  });
});
