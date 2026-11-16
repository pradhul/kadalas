import {
  DECORATION_SKIP_LABEL,
  AttachmentDedupeSet,
  evaluateAttachment,
  isDecorationFileName,
  shouldKeepAttachment,
} from '../src/lib/attachmentFilter';
import { isPendingDecorationCandidate } from '../src/lib/attachmentFilter';

describe('attachmentFilter decorations', () => {
  it('drops Footer-0-0.jpg and Outlook image001.png and logo.png', () => {
    for (const name of ['Footer-0-0.jpg', 'image001.png', 'logo.png']) {
      expect(isDecorationFileName(name)).toBe(true);
      expect(
        evaluateAttachment({
          fileName: name,
          mimeType: 'image/jpeg',
          size: 12_000,
          subject: 'Federal Bank alert',
          from: 'alerts@federalbank.co.in',
        }).keep,
      ).toBe(false);
    }
  });

  it('keeps Aadhaar.jpg even when small', () => {
    const result = evaluateAttachment({
      fileName: 'Aadhaar.jpg',
      mimeType: 'image/jpeg',
      size: 20_000,
      subject: 'Your Aadhaar',
    });
    expect(result.keep).toBe(true);
  });

  it('drops inline cid parts and small images without doc hints', () => {
    expect(
      evaluateAttachment({
        fileName: 'spacer.png',
        mimeType: 'image/png',
        size: 4_000,
        isInline: true,
        contentId: 'abc',
        referencedAsCid: true,
      }).keep,
    ).toBe(false);

    expect(
      evaluateAttachment({
        fileName: 'photo.jpg',
        mimeType: 'image/jpeg',
        size: 30_000,
        subject: 'Hello',
      }).keep,
    ).toBe(false);
  });

  it('dedupes identical footer fingerprints across emails', () => {
    const dedupe = new AttachmentDedupeSet();
    const footer = {
      fileName: 'Footer-0-0.jpg',
      mimeType: 'image/jpeg',
      size: 15_000,
    };
    // First evaluate filters it as decoration; shouldKeep still records fingerprint
    expect(shouldKeepAttachment(footer, dedupe)).toBe(false);
    expect(shouldKeepAttachment(footer, dedupe)).toBe(false);
  });

  it('flags pending review decorations for auto-skip', () => {
    expect(
      isPendingDecorationCandidate({
        fileName: 'Footer-1-0.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 10_000,
        subject: 'Federal Bank',
        from: 'a@federalbank.co.in',
        status: 'pending',
      }),
    ).toBe(true);
    expect(DECORATION_SKIP_LABEL).toMatch(/Filtered: email decoration/);
  });
});
