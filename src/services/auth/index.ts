import { useMocks } from '../config';
import { createGoogleAuthService } from './googleAuth';
import { createMockAuthService } from './mockAuth';
import { AuthService } from './types';

export * from './types';
export * from './errors';
export { subscribeAuthEvents, emitAuthEvent } from './authEvents';

let singleton: AuthService | null = null;

export function getAuthService(): AuthService {
  if (!singleton) {
    singleton = useMocks() ? createMockAuthService() : createGoogleAuthService();
  }
  return singleton;
}

export function resetAuthService(): void {
  singleton = null;
}
