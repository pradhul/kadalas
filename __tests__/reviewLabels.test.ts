import { normalizeCategory } from '../src/lib/folders';
import {
  confidenceBand,
  looksLikeInternalKey,
  reviewCardSubtitle,
} from '../src/lib/reviewLabels';
import { ScanCandidate } from '../src/types/document';

describe('reviewLabels', () => {
  it('hides internal keys like TermLoans.CreditCar', () => {
    expect(looksLikeInternalKey('TermLoans.CreditCar')).toBe(true);
    expect(looksLikeInternalKey('Federal Bank')).toBe(false);
  });

  it('maps loan product codes to Banking, not vehicle insurance', () => {
    expect(normalizeCategory('TermLoans.CreditCar EO20919053')).toBe('Banking');
  });

  it('does not show comprehensive cover without evidence', () => {
    const c: ScanCandidate = {
      id: '1',
      gmailMessageId: 'm',
      gmailAttachmentId: 'a',
      subject: 'Loan',
      from: 'x@bank.com',
      date: '2026-01-01T00:00:00Z',
      fileName: '030326EO20919053.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 10,
      status: 'pending',
      classification: {
        category: 'Banking',
        title: 'Loan',
        metadata: {
          issuer: 'TermLoans.CreditCar',
          coverageType: 'comprehensive',
          documentType: 'od_only',
        },
        confidence: 0.3,
        isImportantDocument: true,
      },
    };
    const sub = reviewCardSubtitle(c);
    expect(sub).not.toMatch(/TermLoans/);
    expect(sub).not.toMatch(/comprehensive/i);
    expect(sub).toMatch(/Banking/);
  });

  it('bands confidence', () => {
    expect(confidenceBand(0.9)).toBe('high');
    expect(confidenceBand(0.5)).toBe('medium');
    expect(confidenceBand(0.2)).toBe('low');
  });
});
