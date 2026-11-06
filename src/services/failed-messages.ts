import { randomUUID } from "crypto";
import type { TelegramMessage } from "../types";

const TTL_MS = 30 * 60 * 1000;

/**
 * Keeps the original message of a failed request in memory so the "Reintentar"
 * button can process it again without the user resending it.
 */
class FailedMessages {
  private items = new Map<string, { message: TelegramMessage; expires: number }>();

  save(message: TelegramMessage): string {
    this.prune();
    const id = randomUUID().slice(0, 8);
    this.items.set(id, { message, expires: Date.now() + TTL_MS });
    return id;
  }

  /** Returns the message and forgets it (a retry that fails again saves a new entry). */
  take(id: string): TelegramMessage | null {
    this.prune();
    const item = this.items.get(id);
    if (!item) return null;
    this.items.delete(id);
    return item.message;
  }

  private prune(): void {
    const now = Date.now();
    for (const [id, item] of this.items) {
      if (item.expires < now) this.items.delete(id);
    }
  }
}

export const failedMessages = new FailedMessages();
