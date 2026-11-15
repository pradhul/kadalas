import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { AiProviderId } from '../types/document';

const AI_KEY_PREFIX = 'dv_ai_key_';
const AI_PROVIDER_KEY = 'dv_ai_provider';
const AUTH_TOKEN_KEY = 'dv_auth_tokens';

async function setItem(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, value);
    }
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

async function getItem(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem(key);
    }
    return null;
  }
  return SecureStore.getItemAsync(key);
}

async function deleteItem(key: string): Promise<void> {
  if (Platform.OS === 'web') {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(key);
    }
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

export async function saveAiApiKey(provider: AiProviderId, key: string): Promise<void> {
  await setItem(`${AI_KEY_PREFIX}${provider}`, key.trim());
}

export async function getAiApiKey(provider: AiProviderId): Promise<string | null> {
  return getItem(`${AI_KEY_PREFIX}${provider}`);
}

export async function clearAiApiKey(provider: AiProviderId): Promise<void> {
  await deleteItem(`${AI_KEY_PREFIX}${provider}`);
}

export async function savePreferredProvider(provider: AiProviderId): Promise<void> {
  await setItem(AI_PROVIDER_KEY, provider);
}

export async function getPreferredProvider(): Promise<AiProviderId> {
  const value = await getItem(AI_PROVIDER_KEY);
  if (
    value === 'openai' ||
    value === 'anthropic' ||
    value === 'openrouter' ||
    value === 'groq' ||
    value === 'gemini' ||
    value === 'mock'
  ) {
    return value;
  }
  return 'gemini';
}

export interface StoredTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  idToken?: string;
  email?: string;
  name?: string;
  picture?: string;
}

export async function saveAuthTokens(tokens: StoredTokens): Promise<void> {
  await setItem(AUTH_TOKEN_KEY, JSON.stringify(tokens));
}

export async function getAuthTokens(): Promise<StoredTokens | null> {
  const raw = await getItem(AUTH_TOKEN_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredTokens;
  } catch {
    return null;
  }
}

export async function clearAuthTokens(): Promise<void> {
  await deleteItem(AUTH_TOKEN_KEY);
}

export function isWebStorageWarningNeeded(): boolean {
  return Platform.OS === 'web';
}
