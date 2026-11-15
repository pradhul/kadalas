import { RequestQueue } from '../../lib/rateLimit';
import { AiProviderId, AiUsageStats } from '../../types/document';
import { useMocks } from '../config';
import { getAiApiKey, getPreferredProvider, savePreferredProvider } from '../secureStorage';
import {
  AI_PROVIDER_OPTIONS,
  GROQ_BASE_URL,
  GROQ_DEFAULT_MODEL,
  OPENROUTER_DEFAULT_MODEL,
} from './catalog';
import { createGeminiProvider } from './gemini';
import { createMockAiProvider } from './mockAi';
import { createOpenAiCompatibleProvider } from './openaiCompatible';
import { AiProvider, AiService, TriageItemInput } from './types';
import { MOCK_QUOTA_EVERY_N_AI_CALLS } from '../../mocks/mailbox';

export * from './types';
export {
  AI_PROVIDER_OPTIONS,
  GROQ_BASE_URL,
  GROQ_DEFAULT_MODEL,
  OPENROUTER_DEFAULT_MODEL,
} from './catalog';
export type { AiProviderOption, AiProviderTier } from './catalog';

function buildProviders(): Record<AiProviderId, AiProvider> {
  return {
    mock: createMockAiProvider(),
    gemini: createGeminiProvider(() => getAiApiKey('gemini')),
    openai: createOpenAiCompatibleProvider({
      id: 'openai',
      displayName: 'OpenAI',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      getApiKey: () => getAiApiKey('openai'),
      style: 'openai',
    }),
    anthropic: createOpenAiCompatibleProvider({
      id: 'anthropic',
      displayName: 'Anthropic',
      baseUrl: 'https://api.anthropic.com/v1',
      model: 'claude-3-5-haiku-latest',
      getApiKey: () => getAiApiKey('anthropic'),
      style: 'anthropic',
    }),
    openrouter: createOpenAiCompatibleProvider({
      id: 'openrouter',
      displayName: 'OpenRouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      model: OPENROUTER_DEFAULT_MODEL,
      getApiKey: () => getAiApiKey('openrouter'),
      style: 'openai',
    }),
    groq: createOpenAiCompatibleProvider({
      id: 'groq',
      displayName: 'Groq',
      baseUrl: GROQ_BASE_URL,
      model: GROQ_DEFAULT_MODEL,
      getApiKey: () => getAiApiKey('groq'),
      style: 'openai',
    }),
  };
}

export function createAiService(): AiService {
  const providers = buildProviders();
  let providerId: AiProviderId = useMocks() ? 'mock' : 'gemini';
  let requestsToday = 0;
  let lastRequestAt: string | null = null;
  let lastError: string | null = null;
  let mockQuotaFailAfter: number | null = useMocks() ? MOCK_QUOTA_EVERY_N_AI_CALLS : null;
  let callsSinceResume = 0;
  const listeners = new Set<(stats: AiUsageStats) => void>();

  const emit = (queueDepth: number, rateLimitedUntil: number | null) => {
    const stats: AiUsageStats = {
      requestsToday,
      lastRequestAt,
      lastError,
      queueDepth,
      rateLimitedUntil: rateLimitedUntil ? new Date(rateLimitedUntil).toISOString() : null,
    };
    listeners.forEach((l) => l(stats));
  };

  const queue = new RequestQueue(
    { maxConcurrent: 1, minIntervalMs: 800, maxPerWindow: 20, windowMs: 60_000 },
    (q) => emit(q.pending + q.active, q.rateLimitedUntil),
  );

  void getPreferredProvider().then((id) => {
    if (!useMocks()) providerId = id === 'mock' ? 'gemini' : id;
  });

  const run = async <T>(fn: () => Promise<T>): Promise<T> => {
    return queue.enqueue(async () => {
      if (mockQuotaFailAfter != null && callsSinceResume >= mockQuotaFailAfter) {
        // Do not reset the counter here — retries would immediately succeed.
        // Counter resets only on __setMockQuotaFailAfter (start / resume).
        const err = new Error('Mock free-tier quota exceeded (429)') as Error & {
          status: number;
          noRetry: boolean;
        };
        err.status = 429;
        err.noRetry = true; // scan engine must pause; queue must not backoff-retry
        lastError = err.message;
        emit(queue.getStats().pending + queue.getStats().active, Date.now() + 60_000);
        throw err;
      }
      try {
        const result = await fn();
        requestsToday += 1;
        callsSinceResume += 1;
        lastRequestAt = new Date().toISOString();
        lastError = null;
        emit(queue.getStats().pending + queue.getStats().active, queue.getStats().rateLimitedUntil);
        return result;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        emit(queue.getStats().pending + queue.getStats().active, queue.getStats().rateLimitedUntil);
        throw err;
      }
    });
  };

  const service: AiService = {
    getProviderId: () => providerId,

    async setProvider(id) {
      providerId = id;
      await savePreferredProvider(id);
    },

    async hasApiKey() {
      if (providerId === 'mock') return true;
      const key = await getAiApiKey(providerId);
      return Boolean(key && key.trim().length > 8);
    },

    classifyDocument(input) {
      const provider = providers[providerId] || providers.mock;
      return run(() => provider.classifyDocument(input));
    },

    confirmVersion(input) {
      const provider = providers[providerId] || providers.mock;
      return run(() => provider.confirmVersion(input));
    },

    triageBatch(items: TriageItemInput[]) {
      const provider = providers[providerId] || providers.mock;
      return run(async () => {
        if (provider.triageBatch) return provider.triageBatch(items);
        // Fallback: treat each as important if rules say so
        const mock = providers.mock;
        return mock.triageBatch!(items);
      });
    },

    async testKey() {
      if (providerId === 'mock') {
        return { ok: true, message: 'Offline heuristics — no key required.' };
      }
      const key = await getAiApiKey(providerId);
      if (!key || key.trim().length < 8) {
        return { ok: false, message: 'No API key saved for this provider.' };
      }
      try {
        const provider = providers[providerId] || providers.mock;
        // Bypass the quota mock so Settings "Test key" still works in demo builds.
        const previousQuota = mockQuotaFailAfter;
        mockQuotaFailAfter = null;
        try {
          const result = await run(() =>
            provider.classifyDocument({
              fileName: 'kadalas-key-test.txt',
              mimeType: 'text/plain',
              textExcerpt: 'Kadalas settings key test. Short insurance renewal notice.',
              subject: 'Key test',
              from: 'settings@kadalas.local',
            }),
          );
          const title = result.title || result.category || 'ok';
          return { ok: true, message: `Key works — sample reply: “${title}”` };
        } finally {
          mockQuotaFailAfter = previousQuota;
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { ok: false, message: msg };
      }
    },

    getUsage() {
      const q = queue.getStats();
      return {
        requestsToday,
        lastRequestAt,
        lastError,
        queueDepth: q.pending + q.active,
        rateLimitedUntil: q.rateLimitedUntil ? new Date(q.rateLimitedUntil).toISOString() : null,
      };
    },

    subscribeUsage(listener) {
      listeners.add(listener);
      listener(this.getUsage());
      return () => listeners.delete(listener);
    },

    __setMockQuotaFailAfter(n: number) {
      mockQuotaFailAfter = n;
      callsSinceResume = 0;
    },
  };

  return service;
}

let singleton: AiService | null = null;

export function getAiService(): AiService {
  if (!singleton) singleton = createAiService();
  return singleton;
}

export function resetAiService(): void {
  singleton = null;
}
