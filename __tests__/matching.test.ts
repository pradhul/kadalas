import {
  buildGmailSearchQuery,
  isNewerVersion,
  referencesMatch,
  scoreDocumentMatch,
  toGmailAfter,
} from '../src/lib/matching';

describe('matching', () => {
  const existing = {
    title: 'GEICO Vehicle Policy',
    category: 'Insurance/Vehicle' as const,
    metadata: {
      issuer: 'GEICO',
      documentType: 'Policy document',
      referenceNumber: 'POL-88421-VA',
      holderName: 'Pradhul Dev',
      issueDate: '2025-01-12',
    },
  };

  it('matches reference numbers with punctuation differences', () => {
    expect(referencesMatch('POL-88421-VA', 'POL88421VA')).toBe(true);
    expect(referencesMatch('POL-88421-VA', 'OTHER')).toBe(false);
  });

  it('scores a strong same-policy match above threshold', () => {
    const result = scoreDocumentMatch(existing, {
      title: 'GEICO renewal',
      category: 'Insurance/Vehicle',
      metadata: {
        issuer: 'GEICO',
        referenceNumber: 'POL-88421-VA',
        documentType: 'Renewal notice',
        holderName: 'Pradhul Dev',
      },
    });
    expect(result.isLikelySame).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(0.65);
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it('does not match unrelated documents', () => {
    const result = scoreDocumentMatch(existing, {
      title: 'City Power bill',
      category: 'Bills',
      metadata: { issuer: 'City Power', referenceNumber: 'UTIL-1', documentType: 'Utility bill' },
    });
    expect(result.isLikelySame).toBe(false);
  });

  it('builds a Gmail query with after: date and issuer/ref', () => {
    const q = buildGmailSearchQuery(existing, '2026-01-15T00:00:00.000Z');
    expect(q).toContain('has:attachment');
    expect(q).toContain('GEICO');
    expect(q).toContain('POL-88421-VA');
    expect(q).toContain('after:2026/01/15');
  });

  it('converts ISO to Gmail after format', () => {
    expect(toGmailAfter('2026-03-05T12:00:00.000Z')).toBe('2026/03/05');
  });

  it('detects newer versions by date', () => {
    expect(isNewerVersion('2026-01-01', '2026-02-01')).toBe(true);
    expect(isNewerVersion('2026-02-01', '2026-01-01')).toBe(false);
  });
});
