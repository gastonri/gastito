/**
 * Remembers recently seen keys so an update Telegram redelivers (because the webhook
 * answered too slowly) is processed only once.
 */
export class RecentSet {
  private readonly seen = new Map<number, number>();

  constructor(
    private readonly ttlMs = 10 * 60 * 1000,
    private readonly maxSize = 1000
  ) {}

  /** Returns true if the key was already seen; otherwise records it and returns false. */
  has(key: number, now = Date.now()): boolean {
    this.prune(now);
    if (this.seen.has(key)) return true;
    this.seen.set(key, now);
    return false;
  }

  private prune(now: number): void {
    for (const [key, at] of this.seen) {
      if (now - at <= this.ttlMs && this.seen.size <= this.maxSize) break;
      this.seen.delete(key);
    }
  }
}
