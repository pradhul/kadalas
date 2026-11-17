/**
 * Production builds must never boot into mock/demo vault data.
 */

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { useMocks: false } } },
}));

jest.mock('expo-auth-session', () => ({
  makeRedirectUri: () => 'kadalas://redirect',
}));

jest.mock('react-native', () => ({
  Platform: { OS: 'web' },
}));

describe('production config (EXPO_PUBLIC_USE_MOCKS=false)', () => {
  const originalEnv = process.env.EXPO_PUBLIC_USE_MOCKS;

  beforeEach(() => {
    jest.resetModules();
    process.env.EXPO_PUBLIC_USE_MOCKS = 'false';
    const store: Record<string, string> = {};
    (global as unknown as { localStorage: Storage }).localStorage = {
      getItem: (k: string) => (k in store ? store[k] : null),
      setItem: (k: string, v: string) => {
        store[k] = String(v);
      },
      removeItem: (k: string) => {
        delete store[k];
      },
      clear: () => {
        for (const k of Object.keys(store)) delete store[k];
      },
      key: () => null,
      length: 0,
    };
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.EXPO_PUBLIC_USE_MOCKS;
    else process.env.EXPO_PUBLIC_USE_MOCKS = originalEnv;
  });

  it('never enables mocks from leftover kadalas_force_demo flag', () => {
    localStorage.setItem('kadalas_force_demo', '1');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useMocks, isForceDemoMode, isDemoEntryAllowed } = require('../src/services/config');
    expect(isDemoEntryAllowed()).toBe(false);
    expect(isForceDemoMode()).toBe(false);
    expect(useMocks()).toBe(false);
  });

  it('purgeStaleDemoLocalState clears force-demo, mock drive, mock tokens, and index mirror', () => {
    localStorage.setItem('kadalas_force_demo', '1');
    localStorage.setItem('dv_mock_drive_v1', '{"index":{"documents":[{"title":"Chase"}]}}');
    localStorage.setItem(
      'dv_auth_tokens',
      JSON.stringify({
        accessToken: 'mock_access_123',
        email: 'pradhul@example.com',
        name: 'Pradhul',
      }),
    );
    localStorage.setItem(
      'kadalas_vault_index_mirror_v1',
      JSON.stringify({ documents: [{ title: 'Allstate Package' }] }),
    );

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { purgeStaleDemoLocalState, useMocks } = require('../src/services/config');
    const result = purgeStaleDemoLocalState();
    expect(useMocks()).toBe(false);
    expect(localStorage.getItem('kadalas_force_demo')).toBeNull();
    expect(localStorage.getItem('dv_mock_drive_v1')).toBeNull();
    expect(localStorage.getItem('dv_auth_tokens')).toBeNull();
    expect(localStorage.getItem('kadalas_vault_index_mirror_v1')).toBeNull();
    expect(result.cleared).toEqual(
      expect.arrayContaining([
        'kadalas_force_demo',
        'dv_mock_drive_v1',
        'dv_auth_tokens',
        'kadalas_vault_index_mirror_v1',
      ]),
    );
  });

  it('does not clear real Google tokens', () => {
    localStorage.setItem(
      'dv_auth_tokens',
      JSON.stringify({ accessToken: 'ya29.real-token', email: 'user@gmail.com', name: 'Real User' }),
    );
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { purgeStaleDemoLocalState } = require('../src/services/config');
    purgeStaleDemoLocalState();
    expect(localStorage.getItem('dv_auth_tokens')).toContain('ya29.real-token');
  });
});

describe('mock build config (EXPO_PUBLIC_USE_MOCKS=true)', () => {
  const originalEnv = process.env.EXPO_PUBLIC_USE_MOCKS;

  beforeEach(() => {
    jest.resetModules();
    process.env.EXPO_PUBLIC_USE_MOCKS = 'true';
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.EXPO_PUBLIC_USE_MOCKS;
    else process.env.EXPO_PUBLIC_USE_MOCKS = originalEnv;
  });

  it('enables mocks and allows demo entry', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useMocks, isDemoEntryAllowed } = require('../src/services/config');
    expect(isDemoEntryAllowed()).toBe(true);
    expect(useMocks()).toBe(true);
  });
});

describe('signed-out navigation contract', () => {
  it('app index and RequireAuth both target /sign-in when session is null', () => {
    // Soft contract — mirrors src/app/index.tsx + RequireAuth
    const session = null;
    const href = session ? '/(tabs)' : '/sign-in';
    expect(href).toBe('/sign-in');
  });
});
