import {
  classifyWithRules,
  shouldConsiderAttachment,
} from '../src/lib/categorisation';
import { normalizeCategory } from '../src/lib/folders';
import { RequestQueue } from '../src/lib/rateLimit';

describe('categorisation', () => {
  it('filters out promo images without document signals', () => {
    expect(
      shouldConsiderAttachment({
        subject: '50% off spring sale',
        from: 'deals@shop.example',
        snippet: 'Unsubscribe anytime',
        fileName: 'flyer.jpg',
        mimeType: 'image/jpeg',
      }),
    ).toBe(false);
  });

  it('keeps PDF policy attachments', () => {
    expect(
      shouldConsiderAttachment({
        subject: 'Your GEICO policy documents',
        from: 'noreply@geico.com',
        fileName: 'policy.pdf',
        mimeType: 'application/pdf',
      }),
    ).toBe(true);
  });

  it('rule-classifies vehicle insurance email', () => {
    const result = classifyWithRules({
      subject: 'GEICO policy renewal POL-12345',
      from: 'GEICO <noreply@geico.com>',
      fileName: 'policy.pdf',
      textExcerpt: 'Vehicle insurance policy number POL-12345 expires 2026-12-01',
    });
    expect(result.category).toBe('Insurance/Vehicle');
    expect(result.isImportantDocument).toBe(true);
    expect(result.metadata.referenceNumber).toBeTruthy();
  });

  it('normalizes free-text categories', () => {
    expect(normalizeCategory('car insurance')).toBe('Insurance/Vehicle');
    expect(normalizeCategory('Bank statements')).toBe('Banking');
    expect(normalizeCategory('something weird')).toBe('Other');
  });
});

describe('rate limit queue', () => {
  it('queues work and reports stats', async () => {
    const stats: Array<number> = [];
    const queue = new RequestQueue(
      { maxConcurrent: 1, minIntervalMs: 10, maxPerWindow: 5, windowMs: 1000, maxRetries: 1, baseBackoffMs: 10 },
      (s) => stats.push(s.pending + s.active),
    );

    const results = await Promise.all([
      queue.enqueue(async () => 1),
      queue.enqueue(async () => 2),
      queue.enqueue(async () => 3),
    ]);

    expect(results).toEqual([1, 2, 3]);
    expect(queue.getStats().completed).toBe(3);
    expect(stats.some((n) => n > 0)).toBe(true);
  });

  it('retries on 429 then succeeds', async () => {
    let attempts = 0;
    const queue = new RequestQueue({
      maxConcurrent: 1,
      minIntervalMs: 5,
      maxPerWindow: 10,
      windowMs: 1000,
      maxRetries: 3,
      baseBackoffMs: 5,
    });

    const value = await queue.enqueue(async () => {
      attempts += 1;
      if (attempts < 2) {
        const err = new Error('rate limited') as Error & { status: number };
        err.status = 429;
        throw err;
      }
      return 'ok';
    });

    expect(value).toBe('ok');
    expect(attempts).toBe(2);
  });
});
