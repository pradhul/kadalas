export const DEFAULT_FETCH_TIMEOUT_MS = 30_000;
export const GIS_SILENT_TIMEOUT_MS = 10_000;

export class TimeoutError extends Error {
  readonly retryable = true;
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'TimeoutError';
    this.status = status;
  }
}

/** fetch() with AbortController timeout. Throws TimeoutError (retryable) on expiry. */
export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(input, {
      ...init,
      signal: init.signal ?? controller.signal,
    });
    return res;
  } catch (err) {
    if (err instanceof Error && (err.name === 'AbortError' || err.message.toLowerCase().includes('aborted'))) {
      throw new TimeoutError(`Request timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Race a promise against a timeout (for GIS silent renew). */
export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(message)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
