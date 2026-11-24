/**
 * Token-bucket bandwidth limiter shared by all HTTP downloads.
 * The bucket holds at most a quarter second of traffic, so the configured
 * limit is respected even over short periods (no multi-megabyte bursts).
 */
export class RateLimiter {
  private capacity = 0;
  private tokens = 0;
  private refillRate = 0; // bytes per second, 0 = unlimited
  private lastRefill = Date.now();

  constructor(limitKBps = 0) {
    this.setLimit(limitKBps);
    this.tokens = this.capacity;
  }

  public setLimit(limitKBps: number): void {
    this.refillRate = limitKBps > 0 ? limitKBps * 1024 : 0;
    this.capacity = Math.max(this.refillRate / 4, 16 * 1024);
    this.tokens = Math.min(this.tokens, this.capacity);
  }

  public getLimitKBps(): number {
    return this.refillRate > 0 ? Math.round(this.refillRate / 1024) : 0;
  }

  public isUnlimited(): boolean {
    return this.refillRate <= 0;
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.lastRefill = now;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillRate);
  }

  public async acquire(bytes: number): Promise<void> {
    while (this.refillRate > 0) {
      this.refill();
      // Chunks larger than the bucket are allowed once it is full, leaving a debt
      const needed = Math.min(bytes, this.capacity);
      if (this.tokens >= needed) {
        this.tokens -= bytes;
        return;
      }
      const waitMs = Math.ceil(((needed - this.tokens) / this.refillRate) * 1000);
      await new Promise((r) => setTimeout(r, Math.min(Math.max(waitMs, 5), 250)));
    }
  }
}
