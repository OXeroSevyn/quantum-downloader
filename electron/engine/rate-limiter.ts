/**
 * Token Bucket Rate Limiter for bandwidth throttling
 */
export class RateLimiter {
  private capacity: number; // Max burst in bytes
  private tokens: number;   // Current available tokens
  private refillRate: number; // Bytes per second (0 = unlimited)
  private lastRefillTime: number;

  constructor(limitKBps: number = 0) {
    this.refillRate = limitKBps > 0 ? limitKBps * 1024 : 0;
    this.capacity = Math.max(this.refillRate * 2, 64 * 1024);
    this.tokens = this.capacity;
    this.lastRefillTime = Date.now();
  }

  public setLimit(limitKBps: number): void {
    this.refillRate = limitKBps > 0 ? limitKBps * 1024 : 0;
    this.capacity = Math.max(this.refillRate * 2, 64 * 1024);
    if (this.tokens > this.capacity) {
      this.tokens = this.capacity;
    }
  }

  public getLimitKBps(): number {
    return this.refillRate > 0 ? Math.round(this.refillRate / 1024) : 0;
  }

  public isUnlimited(): boolean {
    return this.refillRate <= 0;
  }

  private refill(): void {
    const now = Date.now();
    const elapsedSeconds = (now - this.lastRefillTime) / 1000;
    this.lastRefillTime = now;

    if (this.refillRate > 0) {
      this.tokens = Math.min(this.capacity, this.tokens + elapsedSeconds * this.refillRate);
    } else {
      this.tokens = this.capacity;
    }
  }

  public async acquire(bytes: number): Promise<void> {
    if (this.refillRate <= 0) return;

    while (true) {
      this.refill();
      if (this.tokens >= bytes) {
        this.tokens -= bytes;
        return;
      }

      // Calculate how long to wait for tokens
      const needed = bytes - this.tokens;
      const waitMs = Math.min(Math.max(Math.ceil((needed / this.refillRate) * 1000), 10), 500);
      await new Promise(resolve => setTimeout(resolve, waitMs));
    }
  }
}
