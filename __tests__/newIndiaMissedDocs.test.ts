import { classifyWithRules } from '../src/lib/categorisation';
import {
  extractIndianRegistrations,
  normalizeIndianRegistration,
  formatIndianRegistration,
} from '../src/lib/indianRegistration';
import { gmailAddressesMatch, normalizeGmailAddress } from '../src/lib/gmailAddress';
import { buildKnownDocsQueries, resolveKnownDocsFromFixtures } from '../src/lib/knownDocsPass';
import { buildScanGmailQuery } from '../src/lib/scanPipeline';
import {
  emailA,
  emailBClausePdf,
  emailBHint,
  emailBSchedulePdf,
  LOOKBACK_AFTER_MID_NOV,
  NEW_INDIA_POLICY,
  NEXON_REG,
} from './fixtures/newIndiaNexon';

describe('Indian registration regex', () => {
  it('normalizes KL-12-P-2727 / KL 12 P 2727 / KL12P2727', () => {
    expect(normalizeIndianRegistration('KL-12-P-2727')).toBe(NEXON_REG);
    expect(normalizeIndianRegistration('KL 12 P 2727')).toBe(NEXON_REG);
    expect(normalizeIndianRegistration('KL12P2727')).toBe(NEXON_REG);
    expect(formatIndianRegistration(NEXON_REG)).toBe('KL-12-P-2727');
  });

  it('extracts registration from New India Email A body', () => {
    const regs = extractIndianRegistrations(emailA.snippet);
    expect(regs).toContain(NEXON_REG);
  });
});

describe('Gmail address normalization (never filter by exact To:)', () => {
  it('treats dotted Gmail local-parts as the same mailbox', () => {
    expect(normalizeGmailAddress('pradhuldev.1990@gmail.com')).toBe('pradhuldev1990@gmail.com');
    expect(
      gmailAddressesMatch('pradhuldev.1990@gmail.com', 'pradhuldev1990@gmail.com'),
    ).toBe(true);
    expect(
      gmailAddressesMatch(
        'Pradhul <pradhuldev.1990@gmail.com>',
        'pradhuldev1990+kadalas@gmail.com',
      ),
    ).toBe(true);
  });
});

describe('New India Nexon miss — lookback + known-docs pass', () => {
  it('full scan query has in:anywhere and no after:', () => {
    const q = buildScanGmailQuery({ mode: 'full' });
    expect(q).toMatch(/in:anywhere/);
    expect(q).not.toMatch(/after:/);
  });

  it('lookback from mid-Nov would miss the July emails', () => {
    const q = buildScanGmailQuery({
      mode: 'lookback',
      lookbackDays: 90,
      sinceIso: null,
    });
    // Force the fixture cutoff into the assertion via date compare
    const july = Date.parse(emailBHint.date);
    const cutoff = Date.parse(LOOKBACK_AFTER_MID_NOV);
    expect(july).toBeLessThan(cutoff);
    expect(q).toMatch(/after:/);
  });

  it('known-docs queries include newindia.co.in with no date limit', () => {
    const qs = buildKnownDocsQueries({ vehicleRegistrations: [NEXON_REG] });
    expect(qs.some((q) => /newindia\.co\.in/i.test(q) && !/after:/i.test(q))).toBe(true);
    expect(qs.some((q) => q.includes(NEXON_REG) || q.includes('KL-12-P-2727'))).toBe(true);
  });

  it('known-docs pass + linking produces the PDF candidate labelled vehicle insurance with KL12P2727', () => {
    const hits = resolveKnownDocsFromFixtures({
      messages: [
        emailA,
        { ...emailBHint, attachments: [emailBSchedulePdf, emailBClausePdf] },
      ],
      lookbackAfterIso: LOOKBACK_AFTER_MID_NOV,
    });

    expect(hits.length).toBeGreaterThanOrEqual(1);
    const schedule = hits.find((h) => h.attachmentId === 'att_schedule_pdf');
    expect(schedule).toBeTruthy();
    expect(schedule!.linked?.registrationNumber).toBe(NEXON_REG);
    expect(schedule!.linked?.referenceNumber).toBe(NEW_INDIA_POLICY);

    const classified = classifyWithRules({
      from: schedule!.from,
      subject: schedule!.subject,
      fileName: schedule!.filename,
      mimeType: schedule!.mimeType,
      snippet: [
        schedule!.snippet,
        `Vehicle ${schedule!.linked!.registrationNumber}`,
        `Policy ${schedule!.linked!.referenceNumber}`,
      ].join(' · '),
      textExcerpt: emailA.snippet,
    });

    expect(classified.category).toBe('Insurance/Vehicle');
    expect(classified.metadata.registrationNumber).toBe(NEXON_REG);
    expect(classified.title).toMatch(/KL12P2727/);
    expect(classified.title).toMatch(/New India|Motor insurance/i);
  });
});
