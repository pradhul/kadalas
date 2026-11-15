import { clearAuthTokens, getAuthTokens, saveAuthTokens } from '../secureStorage';
import { AuthService, AuthSession } from './types';

const MOCK_USER = {
  email: 'pradhul@example.com',
  name: 'Pradhul',
  picture: undefined as string | undefined,
};

export function createMockAuthService(): AuthService {
  return {
    async getSession() {
      const tokens = await getAuthTokens();
      if (!tokens?.accessToken?.startsWith('mock_')) return null;
      return {
        user: {
          email: tokens.email || MOCK_USER.email,
          name: tokens.name || MOCK_USER.name,
          picture: tokens.picture,
        },
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
        isMock: true,
      };
    },

    async signIn() {
      const session: AuthSession = {
        user: MOCK_USER,
        accessToken: `mock_access_${Date.now()}`,
        refreshToken: `mock_refresh_${Date.now()}`,
        expiresAt: Date.now() + 55 * 60 * 1000,
        isMock: true,
      };
      await saveAuthTokens({
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
        expiresAt: session.expiresAt,
        email: session.user.email,
        name: session.user.name,
      });
      return session;
    },

    async signOut() {
      await clearAuthTokens();
    },

    async getValidAccessToken() {
      const session = await this.getSession();
      if (!session) throw new Error('Not signed in');
      if (session.expiresAt && session.expiresAt < Date.now() + 60_000) {
        const refreshed = await this.signIn();
        return refreshed.accessToken;
      }
      return session.accessToken;
    },
  };
}
