export type AuthEvent = 'expired' | 'restored';

type Listener = (event: AuthEvent) => void;

const listeners = new Set<Listener>();

export function subscribeAuthEvents(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emitAuthEvent(event: AuthEvent): void {
  for (const l of listeners) {
    try {
      l(event);
    } catch {
      // ignore listener failures
    }
  }
}
