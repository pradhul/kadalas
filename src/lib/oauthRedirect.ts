/**
 * Pure redirect resolution (unit-testable without Expo).
 * Web always uses the page origin so any deploy host works.
 */
export function resolveOAuthRedirectUri(input: {
  platform: string;
  webOrigin?: string | null;
  nativeRedirectUri: string;
}): string {
  if (input.platform === 'web' && input.webOrigin) {
    return input.webOrigin;
  }
  return input.nativeRedirectUri;
}
