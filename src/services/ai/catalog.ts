import { AiProviderId } from '../../types/document';

export type AiProviderTier = 'free' | 'paid' | 'offline';

export type AiProviderOption = {
  id: AiProviderId;
  label: string;
  hint: string;
  tier: AiProviderTier;
  /** One-line instructions for getting a key */
  instructions: string;
  /** Browser URL to create / manage an API key */
  getKeyUrl?: string;
  getKeyCta?: string;
};

/** Catalog shown in Settings — free-tier helpers first, paid marked clearly. */
export const AI_PROVIDER_OPTIONS: AiProviderOption[] = [
  {
    id: 'gemini',
    label: 'Google AI Studio (Gemini)',
    hint: 'Default · recommended free tier',
    tier: 'free',
    instructions: 'Create a free API key in Google AI Studio, then paste it below.',
    getKeyUrl: 'https://aistudio.google.com/apikey',
    getKeyCta: 'Get a free key',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    hint: 'Free models (ids ending in :free)',
    tier: 'free',
    instructions: 'Create a key, then pick a free model such as one ending in :free.',
    getKeyUrl: 'https://openrouter.ai/keys',
    getKeyCta: 'Get a free key',
  },
  {
    id: 'groq',
    label: 'Groq',
    hint: 'Free tier · OpenAI-compatible',
    tier: 'free',
    instructions: 'Create a free Groq Cloud key and paste it below.',
    getKeyUrl: 'https://console.groq.com/keys',
    getKeyCta: 'Get a free key',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    hint: 'Paid',
    tier: 'paid',
    instructions: 'Requires a paid OpenAI API account.',
    getKeyUrl: 'https://platform.openai.com/api-keys',
    getKeyCta: 'Get a key (paid)',
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    hint: 'Paid',
    tier: 'paid',
    instructions: 'Requires a paid Anthropic API account.',
    getKeyUrl: 'https://console.anthropic.com/settings/keys',
    getKeyCta: 'Get a key (paid)',
  },
  {
    id: 'mock',
    label: 'Offline heuristics',
    hint: 'No network · no key',
    tier: 'offline',
    instructions: 'Uses on-device rules only — no API key needed.',
  },
];

/**
 * OpenRouter free router (picks a live free model).
 * Fallback if the router rejects: google/gemma-4-31b-it:free
 */
export const OPENROUTER_DEFAULT_MODEL = 'openrouter/free';
export const OPENROUTER_FALLBACK_MODEL = 'google/gemma-4-31b-it:free';

/** Groq production chat model (openai/gpt-oss-20b). */
export const GROQ_DEFAULT_MODEL = 'openai/gpt-oss-20b';
export const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';

/** Shut-down model IDs — tests assert defaults are not these. */
export const SHUTDOWN_MODEL_IDS = [
  'gemini-2.0-flash',
  'llama-3.1-8b-instant',
  'meta-llama/llama-3.2-3b-instruct:free',
] as const;
