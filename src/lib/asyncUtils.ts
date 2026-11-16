/** Yield to the browser/UI thread between heavy scan batches. */
export function yieldToUi(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof setTimeout === 'function') {
      setTimeout(resolve, 0);
      return;
    }
    resolve();
  });
}

/** Throttle a function to at most once per `ms` (trailing call optional). */
export function throttle<T extends (...args: never[]) => void>(
  fn: T,
  ms: number,
): T & { cancel: () => void } {
  let last = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let latestArgs: Parameters<T> | null = null;

  const wrapped = ((...args: Parameters<T>) => {
    const now = Date.now();
    latestArgs = args;
    const remaining = ms - (now - last);
    if (remaining <= 0) {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      last = now;
      fn(...args);
      return;
    }
    if (!timer) {
      timer = setTimeout(() => {
        timer = null;
        last = Date.now();
        if (latestArgs) fn(...latestArgs);
      }, remaining);
    }
  }) as T & { cancel: () => void };

  wrapped.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  return wrapped;
}

/** Debounce a function; optional idle callback when available (web). */
export function debounceIdle<T extends (...args: never[]) => void>(
  fn: T,
  ms: number,
): T & { flush: () => void; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let latestArgs: Parameters<T> | null = null;

  const run = () => {
    timer = null;
    if (!latestArgs) return;
    const args = latestArgs;
    latestArgs = null;
    fn(...args);
  };

  const wrapped = ((...args: Parameters<T>) => {
    latestArgs = args;
    if (timer) clearTimeout(timer);
    if (typeof requestIdleCallback === 'function') {
      timer = setTimeout(() => {
        requestIdleCallback(() => run(), { timeout: ms });
      }, ms) as unknown as ReturnType<typeof setTimeout>;
    } else {
      timer = setTimeout(run, ms);
    }
  }) as T & { flush: () => void; cancel: () => void };

  wrapped.flush = () => {
    if (timer) clearTimeout(timer);
    run();
  };
  wrapped.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    latestArgs = null;
  };
  return wrapped;
}
