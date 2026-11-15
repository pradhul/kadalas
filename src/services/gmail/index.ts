import { useMocks } from '../config';
import { createGoogleGmailService } from './googleGmail';
import { createMockGmailService } from './mockGmail';
import { GmailService } from './types';

export * from './types';

let singleton: GmailService | null = null;

export function getGmailService(): GmailService {
  if (!singleton) {
    singleton = useMocks() ? createMockGmailService() : createGoogleGmailService();
  }
  return singleton;
}

export function resetGmailService(): void {
  singleton = null;
}
