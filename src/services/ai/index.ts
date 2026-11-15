import { RequestQueue } from '../../lib/rateLimit';
import { AiProviderId, AiUsageStats } from '../../types/document';
import { useMocks } from '../config';
import { getAiApiKey, getPreferredProvider, savePreferredProvider } from '../secureStorage';
import { createGeminiProvider } from './gemini';
import { createMockAiProvider } from './mockAi';
import { createOpenAiCompatibleProvider } from './openaiCompatible';
import { AiProvider, AiService } from './types';

export * from './types';

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
      model: 'google/gemini-2.0-flash-001',
      getApiKey: () => getAiApiKey('openrouter'),
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
    { maxConcurrent: 1, minIntervalMs: 1500, maxPerWindow: 10, windowMs: 60_000 },
    (q) => emit(q.pending + q.active, q.rateLimitedUntil),
  );

  void getPreferredProvider().then((id) => {
    if (!useMocks()) providerId = id === 'mock' ? 'gemini' : id;
  });

  const run = async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      const result = await queue.enqueue(fn);
      requestsToday += 1;
      lastRequestAt = new Date().toISOString();
      lastError = null;
      emit(queue.getStats().pending + queue.getStats().active, queue.getStats().rateLimitedUntil);
      return result;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      emit(queue.getStats().pending + queue.getStats().active, queue.getStats().rateLimitedUntil);
      throw err;
    }
  };

  return {
    getProviderId: () => providerId,

    async setProvider(id) {
      providerId = id;
      await savePreferredProvider(id);
    },

    async hasApiKey() {
      if (providerId === 'mock') return true;
      const key = await getAiApiKey(providerId);
      return Boolean(key);
    },

    classifyDocument(input) {
      const provider = providers[providerId] || providers.mock;
      return run(() => provider.classifyDocument(input));
    },

    confirmVersion(input) {
      const provider = providers[providerId] || providers.mock;
      return run(() => provider.confirmVersion(input));
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
  };
}

let singleton: AiService | null = null;

export function getAiService(): AiService {
  if (!singleton) singleton = createAiService();
  return singleton;
}

export function resetAiService(): void {
  singleton = null;
}

export const AI_PROVIDER_OPTIONS: Array<{ id: AiProviderId; label: string; hint: string }> = [
  { id: 'gemini', label: 'Google AI Studio (Gemini)', hint: 'Default — accepts PDFs/images directly' },
  { id: 'openai', label: 'OpenAI', hint: 'Paste an OpenAI API key' },
  { id: 'anthropic', label: 'Anthropic', hint: 'Paste an Anthropic API key' },
  { id: 'openrouter', label: 'OpenRouter', hint: 'One key for many models' },
  { id: 'mock', label: 'Mock / offline', hint: 'Rule-based, no network AI calls' },
];
