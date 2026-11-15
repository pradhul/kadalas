export interface AuthUser {
  email: string;
  name: string;
  picture?: string;
}

export interface AuthSession {
  user: AuthUser;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  isMock: boolean;
}

export interface AuthService {
  getSession(): Promise<AuthSession | null>;
  signIn(): Promise<AuthSession>;
  signOut(): Promise<void>;
  /** Ensure a valid access token, refreshing if needed. */
  getValidAccessToken(): Promise<string>;
}
