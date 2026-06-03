import { TransactionResult } from "../types";
import { Logger } from "../utils/logger";
import { randomUUID } from "crypto";

interface StoredOperation {
  data: TransactionResult[];
  expiresAt: number;
  chatId?: number;
}

class PendingOperationsManager {
  private storage: Map<string, StoredOperation> = new Map();
  private lastPendingByChat: Map<number, string> = new Map();
  private readonly TTL_MS = 30 * 60 * 1000; // 30 minutes

  createOperation(data: TransactionResult[], chatId?: number): string {
    const operationId = randomUUID();
    this.storage.set(operationId, {
      data,
      expiresAt: Date.now() + this.TTL_MS,
      chatId,
    });

    if (chatId) {
      this.lastPendingByChat.set(chatId, operationId);
    }

    Logger.log(`Created pending operation: ${operationId} (${data.length} item(s))${chatId ? ` for chat ${chatId}` : ""}`);
    return operationId;
  }

  getOperation(operationId: string): TransactionResult[] | null {
    const stored = this.storage.get(operationId);

    if (!stored) return null;

    if (Date.now() > stored.expiresAt) {
      this.storage.delete(operationId);
      return null;
    }

    return stored.data;
  }

  deleteOperation(operationId: string): void {
    const operation = this.storage.get(operationId);
    this.storage.delete(operationId);

    if (operation?.chatId) {
      const lastOpId = this.lastPendingByChat.get(operation.chatId);
      if (lastOpId === operationId) {
        this.lastPendingByChat.delete(operation.chatId);
      }
    }

    Logger.log(`Deleted pending operation: ${operationId}`);
  }

  // Returns the single pending item only for single-item batches (used for modification flow)
  getLastPendingOperation(chatId: number): TransactionResult | null {
    const operationId = this.lastPendingByChat.get(chatId);
    if (!operationId) return null;

    const batch = this.getOperation(operationId);
    return batch?.length === 1 ? batch[0] : null;
  }

  updateLastPendingOperation(chatId: number, newData: TransactionResult): string | null {
    const operationId = this.lastPendingByChat.get(chatId);
    if (!operationId) return this.createOperation([newData], chatId);

    const existing = this.storage.get(operationId);
    if (existing && Date.now() < existing.expiresAt) {
      existing.data = [newData];
      existing.expiresAt = Date.now() + this.TTL_MS;
      Logger.log(`Updated pending operation: ${operationId} for chat ${chatId}`);
      return operationId;
    } else {
      this.lastPendingByChat.delete(chatId);
      return this.createOperation([newData], chatId);
    }
  }

  cleanup(): void {
    const now = Date.now();
    let cleaned = 0;
    for (const [key, stored] of this.storage.entries()) {
      if (now > stored.expiresAt) {
        this.storage.delete(key);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      Logger.log(`Cleaned up ${cleaned} expired pending operations`);
    }
  }
}

export const pendingOperations = new PendingOperationsManager();

setInterval(() => { pendingOperations.cleanup(); }, 10 * 60 * 1000);
