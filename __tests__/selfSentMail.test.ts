import {
  buildSelfSentQuery,
  isSelfSentKadalasMessage,
  parseKadalasTitleHint,
  selfSentDedupeKey,
  mailtoKadalasCompose,
} from '../src/lib/selfSentMail';

describe('selfSentMail', () => {
  it('builds Gmail query with optional after: day', () => {
    expect(buildSelfSentQuery()).toContain('from:me to:me has:attachment');
    expect(buildSelfSentQuery()).toContain('subject:kadalas');
    expect(buildSelfSentQuery('2026-11-10T12:00:00.000Z')).toContain('after:2026/11/10');
  });

  it('parses title after kadalas marker', () => {
    expect(parseKadalasTitleHint('kadalas: car RC')).toBe('car RC');
    expect(parseKadalasTitleHint('kadalas car RC')).toBe('car RC');
    expect(parseKadalasTitleHint('#kadalas passport')).toBe('passport');
    expect(parseKadalasTitleHint('hello')).toBeUndefined();
  });

  it('detects self-sent tagged messages', () => {
    expect(
      isSelfSentKadalasMessage({
        from: 'Me <a@x.com>',
        to: 'a@x.com',
        subject: 'kadalas: form 16',
        userEmail: 'a@x.com',
      }),
    ).toBe(true);
    expect(
      isSelfSentKadalasMessage({
        from: 'other@x.com',
        to: 'a@x.com',
        subject: 'kadalas: x',
        userEmail: 'a@x.com',
      }),
    ).toBe(false);
    expect(
      isSelfSentKadalasMessage({
        from: 'a@x.com',
        to: 'a@x.com',
        subject: 'random',
        snippetOrBody: 'please keep #kadalas',
        userEmail: 'a@x.com',
      }),
    ).toBe(true);
  });

  it('dedupe key is stable per message+attachment', () => {
    expect(selfSentDedupeKey('m1', 'a1')).toBe('self:m1:a1');
    expect(selfSentDedupeKey('m1', 'a1')).toBe(selfSentDedupeKey('m1', 'a1'));
  });

  it('mailto compose uses own address + kadalas subject', () => {
    expect(mailtoKadalasCompose('you@ex.com')).toContain('mailto:you%40ex.com');
    expect(mailtoKadalasCompose('you@ex.com')).toContain('subject=kadalas');
  });
});
