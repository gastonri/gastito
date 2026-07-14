import Redis from "ioredis";
import { TransactionResult } from "../types";
import { Logger } from "../utils/logger";
import { randomUUID } from "crypto";
import { config } from "../config";

const TTL_SECONDS = 30 * 60; // 30 minutes

interface StoredOperation {
  data: TransactionResult[];
  chatId?: number;
}

class PendingOperationsManager {
  private redis: Redis;

  constructor() {
    this.redis = this.createRedisClient();
  }

  private createRedisClient(): Redis {
    const client = new Redis(config.redis.url, {
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => {
        if (times > 3) {
          Logger.error("Redis connection failed after 3 retries (pending operations)");
          return null;
        }
        return Math.min(times * 100, 3000);
      },
      lazyConnect: true,
    });

    client.on("error", (err) => {
      Logger.error(
        `Redis error (pending operations): ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err : null
      );
    });

    return client;
  }

  private async ensureConnected(): Promise<void> {
    const status = this.redis.status;

    if (status === "ready" || status === "connect" || status === "connecting" || status === "reconnecting") {
      return;
    }

    if (status === "end") {
      this.redis = this.createRedisClient();
    }

    await this.redis.connect();
  }

  private operationKey(operationId: string): string {
    return `pending_op:${operationId}`;
  }

  private lastByChatKey(chatId: number): string {
    return `pending_op:last:${chatId}`;
  }

  async createOperation(data: TransactionResult[], chatId?: number): Promise<string> {
    await this.ensureConnected();
    const operationId = randomUUID();
    const stored: StoredOperation = { data, chatId };

    await this.redis.setex(this.operationKey(operationId), TTL_SECONDS, JSON.stringify(stored));
    if (chatId) {
      await this.redis.setex(this.lastByChatKey(chatId), TTL_SECONDS, operationId);
    }

    Logger.log(
      `Created pending operation: ${operationId} (${data.length} item(s))${chatId ? ` for chat ${chatId}` : ""}`
    );
    return operationId;
  }

  async getOperation(operationId: string): Promise<TransactionResult[] | null> {
    await this.ensureConnected();
    const raw = await this.redis.get(this.operationKey(operationId));
    if (!raw) return null;

    const stored = JSON.parse(raw) as StoredOperation;
    return stored.data;
  }

  async deleteOperation(operationId: string): Promise<void> {
    await this.ensureConnected();
    const raw = await this.redis.get(this.operationKey(operationId));
    await this.redis.del(this.operationKey(operationId));

    if (raw) {
      const stored = JSON.parse(raw) as StoredOperation;
      if (stored.chatId) {
        const lastOpId = await this.redis.get(this.lastByChatKey(stored.chatId));
        if (lastOpId === operationId) {
          await this.redis.del(this.lastByChatKey(stored.chatId));
        }
      }
    }

    Logger.log(`Deleted pending operation: ${operationId}`);
  }

  // Returns the single pending item only for single-item batches (used for modification flow)
  async getLastPendingOperation(chatId: number): Promise<TransactionResult | null> {
    await this.ensureConnected();
    const operationId = await this.redis.get(this.lastByChatKey(chatId));
    if (!operationId) return null;

    const batch = await this.getOperation(operationId);
    return batch?.length === 1 ? batch[0] : null;
  }

  async updateLastPendingOperation(chatId: number, newData: TransactionResult): Promise<string> {
    await this.ensureConnected();
    const operationId = await this.redis.get(this.lastByChatKey(chatId));
    if (!operationId) return this.createOperation([newData], chatId);

    const exists = await this.redis.exists(this.operationKey(operationId));
    if (!exists) {
      await this.redis.del(this.lastByChatKey(chatId));
      return this.createOperation([newData], chatId);
    }

    const stored: StoredOperation = { data: [newData], chatId };
    await this.redis.setex(this.operationKey(operationId), TTL_SECONDS, JSON.stringify(stored));
    await this.redis.setex(this.lastByChatKey(chatId), TTL_SECONDS, operationId);

    Logger.log(`Updated pending operation: ${operationId} for chat ${chatId}`);
    return operationId;
  }

  async disconnect(): Promise<void> {
    await this.redis.quit();
  }
}

export const pendingOperations = new PendingOperationsManager();
