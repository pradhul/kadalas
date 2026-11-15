import {
  AI_PROVIDER_OPTIONS,
  GROQ_BASE_URL,
  GROQ_DEFAULT_MODEL,
  OPENROUTER_DEFAULT_MODEL,
} from '../src/services/ai/catalog';
import { resolveOAuthRedirectUri } from '../src/lib/oauthRedirect';

describe('AI provider catalog', () => {
  it('includes free Gemini, OpenRouter, Groq and marks OpenAI/Anthropic paid', () => {
    const byId = Object.fromEntries(AI_PROVIDER_OPTIONS.map((o) => [o.id, o]));
    expect(byId.gemini.tier).toBe('free');
    expect(byId.gemini.getKeyUrl).toContain('aistudio.google.com');
    expect(byId.openrouter.tier).toBe('free');
    expect(byId.openrouter.getKeyUrl).toContain('openrouter.ai');
    expect(byId.groq.tier).toBe('free');
    expect(byId.groq.getKeyUrl).toContain('console.groq.com');
    expect(byId.openai.tier).toBe('paid');
    expect(byId.anthropic.tier).toBe('paid');
    expect(byId.mock.tier).toBe('offline');
  });

  it('defaults OpenRouter to a :free model and Groq to openai-compatible base URL', () => {
    expect(OPENROUTER_DEFAULT_MODEL.endsWith(':free')).toBe(true);
    expect(GROQ_BASE_URL).toBe('https://api.groq.com/openai/v1');
    expect(GROQ_DEFAULT_MODEL.length).toBeGreaterThan(3);
  });

  it('lists a get-key CTA for every networked provider', () => {
    for (const opt of AI_PROVIDER_OPTIONS) {
      if (opt.id === 'mock') continue;
      expect(opt.getKeyUrl).toMatch(/^https:\/\//);
      expect(opt.instructions.length).toBeGreaterThan(10);
    }
  });
});

describe('resolveOAuthRedirectUri', () => {
  it('uses window origin on web', () => {
    expect(
      resolveOAuthRedirectUri({
        platform: 'web',
        webOrigin: 'https://kadalas.example.app',
        nativeRedirectUri: 'kadalas://',
      }),
    ).toBe('https://kadalas.example.app');
  });

  it('falls back to native scheme off web', () => {
    expect(
      resolveOAuthRedirectUri({
        platform: 'ios',
        webOrigin: 'https://ignored.example',
        nativeRedirectUri: 'kadalas://oauth',
      }),
    ).toBe('kadalas://oauth');
  });
});
