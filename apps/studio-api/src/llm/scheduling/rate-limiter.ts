export interface LlmRateLimiterConfig {
  globalRequestsPerMinute?: number;
  providerRequestsPerMinute?: Record<string, number>;
  defaultProviderRequestsPerMinute?: number;
  windowMs?: number;
  now?: () => number;
}

export type RateLimitDecision =
  | { ok: true; retryAfterMs: 0 }
  | { ok: false; scope: "global" | "provider"; retryAfterMs: number };

export class LlmRateLimiter {
  private readonly globalTimestamps: number[] = [];
  private readonly providerTimestamps = new Map<string, number[]>();
  private readonly windowMs: number;
  private readonly now: () => number;

  public constructor(private readonly config: LlmRateLimiterConfig) {
    this.windowMs = config.windowMs ?? 60_000;
    this.now = config.now ?? Date.now;
  }

  public tryAcquire(provider: string, at = this.now()): RateLimitDecision {
    const globalLimit = this.config.globalRequestsPerMinute;
    const providerLimit =
      this.config.providerRequestsPerMinute?.[provider] ??
      this.config.defaultProviderRequestsPerMinute;
    const providerItems = this.providerItems(provider);

    this.prune(this.globalTimestamps, at);
    this.prune(providerItems, at);

    if (this.isExhausted(this.globalTimestamps, globalLimit)) {
      return {
        ok: false,
        scope: "global",
        retryAfterMs: this.retryAfter(this.globalTimestamps, at),
      };
    }

    if (this.isExhausted(providerItems, providerLimit)) {
      return {
        ok: false,
        scope: "provider",
        retryAfterMs: this.retryAfter(providerItems, at),
      };
    }

    this.globalTimestamps.push(at);
    providerItems.push(at);
    return { ok: true, retryAfterMs: 0 };
  }

  public usage(provider: string, at = this.now()): { global: number; provider: number } {
    const providerItems = this.providerItems(provider);
    this.prune(this.globalTimestamps, at);
    this.prune(providerItems, at);
    return { global: this.globalTimestamps.length, provider: providerItems.length };
  }

  private providerItems(provider: string): number[] {
    const existing = this.providerTimestamps.get(provider);
    if (existing) return existing;
    const created: number[] = [];
    this.providerTimestamps.set(provider, created);
    return created;
  }

  private prune(items: number[], at: number): void {
    const oldestAllowed = at - this.windowMs;
    while (items.length > 0 && items[0] <= oldestAllowed) items.shift();
  }

  private isExhausted(items: number[], limit: number | undefined): boolean {
    return typeof limit === "number" && limit >= 0 && items.length >= limit;
  }

  private retryAfter(items: number[], at: number): number {
    const oldest = items[0] ?? at;
    return Math.max(1, oldest + this.windowMs - at);
  }
}
