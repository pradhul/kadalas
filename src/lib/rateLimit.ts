export interface RateLimiterOptions {
  maxConcurrent: number;
  minIntervalMs: number;
  maxPerWindow: number;
  windowMs: number;
  maxRetries: number;
  baseBackoffMs: number;
}

export interface QueueStats {
  pending: number;
  active: number;
  completed: number;
  failed: number;
  rateLimitedUntil: number | null;
}

type Task<T> = {
  run: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (err: unknown) => void;
  attempts: number;
};

const DEFAULTS: RateLimiterOptions = {
  maxConcurrent: 1,
  minIntervalMs: 1200,
  maxPerWindow: 12,
  windowMs: 60_000,
  maxRetries: 4,
  baseBackoffMs: 1500,
};

/**
 * Serial/batched request queue with 429 backoff for free-tier AI providers.
 */
export class RequestQueue {
  private options: RateLimiterOptions;
  private queue: Task<unknown>[] = [];
  private active = 0;
  private lastStart = 0;
  private windowStarts: number[] = [];
  private rateLimitedUntil: number | null = null;
  private completed = 0;
  private failed = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private onChange?: (stats: QueueStats) => void;

  constructor(options: Partial<RateLimiterOptions> = {}, onChange?: (stats: QueueStats) => void) {
    this.options = { ...DEFAULTS, ...options };
    this.onChange = onChange;
  }

  getStats(): QueueStats {
    return {
      pending: this.queue.length,
      active: this.active,
      completed: this.completed,
      failed: this.failed,
      rateLimitedUntil: this.rateLimitedUntil,
    };
  }

  enqueue<T>(run: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        run: run as () => Promise<unknown>,
        resolve: resolve as (value: unknown) => void,
        reject,
        attempts: 0,
      });
      this.emit();
      this.pump();
    });
  }

  private emit() {
    this.onChange?.(this.getStats());
  }

  private pump() {
    if (this.timer) return;

    const now = Date.now();
    if (this.rateLimitedUntil && now < this.rateLimitedUntil) {
      this.timer = setTimeout(() => {
        this.timer = null;
        this.pump();
      }, this.rateLimitedUntil - now);
      return;
    }

    while (this.active < this.options.maxConcurrent && this.queue.length > 0) {
      this.windowStarts = this.windowStarts.filter((t) => now - t < this.options.windowMs);
      if (this.windowStarts.length >= this.options.maxPerWindow) {
        const wait = this.options.windowMs - (now - this.windowStarts[0]);
        this.rateLimitedUntil = now + wait;
        this.emit();
        this.timer = setTimeout(() => {
          this.timer = null;
          this.rateLimitedUntil = null;
          this.pump();
        }, wait);
        return;
      }

      const sinceLast = now - this.lastStart;
      if (sinceLast < this.options.minIntervalMs && this.lastStart > 0) {
        this.timer = setTimeout(() => {
          this.timer = null;
          this.pump();
        }, this.options.minIntervalMs - sinceLast);
        return;
      }

      const task = this.queue.shift()!;
      this.active += 1;
      this.lastStart = Date.now();
      this.windowStarts.push(this.lastStart);
      this.emit();
      void this.execute(task);
    }
  }

  private async execute(task: Task<unknown>) {
    try {
      const result = await task.run();
      this.completed += 1;
      task.resolve(result);
    } catch (err) {
      const status = getHttpStatus(err);
      const noRetry = Boolean(err && typeof err === 'object' && (err as { noRetry?: boolean }).noRetry);
      // Intentional quota-pause errors (noRetry) must surface to the scan engine
      if (!noRetry && status === 429 && task.attempts < this.options.maxRetries) {
        task.attempts += 1;
        const backoff =
          this.options.baseBackoffMs * Math.pow(2, task.attempts - 1) + Math.floor(Math.random() * 250);
        this.rateLimitedUntil = Date.now() + backoff;
        this.queue.unshift(task);
      } else {
        this.failed += 1;
        task.reject(err);
      }
    } finally {
      this.active -= 1;
      this.emit();
      this.pump();
    }
  }
}

function getHttpStatus(err: unknown): number | null {
  if (!err || typeof err !== 'object') return null;
  const anyErr = err as { status?: number; statusCode?: number; response?: { status?: number } };
  return anyErr.status ?? anyErr.statusCode ?? anyErr.response?.status ?? null;
}
