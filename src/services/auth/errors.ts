/** Thrown when the Google access token is expired and interactive reconnect is required. */
export class AuthExpiredError extends Error {
  readonly status = 401;
  readonly needsInteraction: boolean;

  constructor(message = 'Session expired — tap to reconnect Google', needsInteraction = true) {
    super(message);
    this.name = 'AuthExpiredError';
    this.needsInteraction = needsInteraction;
  }
}

export function isAuthError(err: unknown): boolean {
  if (err instanceof AuthExpiredError) return true;
  if (!err || typeof err !== 'object') return false;
  const e = err as { status?: number; statusCode?: number; message?: string; name?: string };
  const status = e.status ?? e.statusCode;
  if (status === 401) return true;
  if (e.name === 'AuthExpiredError') return true;
  const msg = (e.message || '').toLowerCase();
  return (
    msg.includes('session expired') ||
    msg.includes('not signed in') ||
    msg.includes('invalid_grant') ||
    msg.includes('invalid credentials') ||
    msg.includes('login required') ||
    msg.includes('auth error') ||
    (msg.includes('unauthorized') && !msg.includes('quota'))
  );
}

/** Map raw Google / OAuth errors to short user-facing copy. */
export function friendlyAuthError(err: unknown): string {
  if (err instanceof AuthExpiredError) return err.message;

  const raw = err instanceof Error ? err.message : String(err ?? '');
  const lower = raw.toLowerCase();

  if (lower.includes('client_secret') || lower.includes('missing a required parameter')) {
    return 'Google sign-in failed. Please try again.';
  }
  if (lower.includes('access_denied') || lower.includes('access denied')) {
    return 'Google sign-in was denied. Grant Gmail and Drive access to continue.';
  }
  if (lower.includes('popup_closed') || lower.includes('popup closed') || lower.includes('dismiss')) {
    return 'Sign-in was cancelled.';
  }
  if (lower.includes('popup_blocked') || lower.includes('popup blocked')) {
    return 'Pop-up blocked. Allow pop-ups for this site and try again.';
  }
  if (lower.includes('network') || lower.includes('failed to fetch')) {
    return 'Network error during Google sign-in. Check your connection and try again.';
  }
  if (lower.includes('client id') || lower.includes('oauth client')) {
    return 'Google sign-in is not configured for this build.';
  }
  if (lower.includes('session expired') || lower.includes('reconnect')) {
    return 'Session expired — tap to reconnect Google.';
  }
  if (lower.includes('sign-in cancelled') || lower.includes('signin cancelled')) {
    return 'Sign-in was cancelled.';
  }
  // Avoid dumping Google's verbose OAuth JSON into the UI
  if (lower.includes('invalid_request') || lower.includes('oauth') || lower.includes('accounts.google')) {
    return 'Google sign-in failed. Please try again.';
  }
  if (raw.length > 140) {
    return 'Something went wrong during Google sign-in. Please try again.';
  }
  return raw || 'Google sign-in failed. Please try again.';
}
