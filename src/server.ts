import express, { Request, Response } from "express";
import { config } from "./config";
import { Logger } from "./utils/logger";
import { TelegramUpdate } from "./types";
import { TelegramClient } from "./bot/telegram";
import { MessageHandlers } from "./bot/handlers";
import { CallbackHandlers } from "./bot/callbacks";
import { AIClientManager } from "./ai/client";
import { SheetsClient } from "./sheets/client";
import { ImageProcessor } from "./services/image-processor";
import { AudioProcessor } from "./services/audio-processor";
import { sessionManager } from "./services/session-manager";
import { pendingOperations } from "./services/pending-operations";
import { ConversationHandler } from "./services/conversation-handler";
import { initializeUserPreferences } from "./services/user-preferences";
import { dispatchCommand } from "./bot/commands";
import { processIncomingMessage } from "./bot/message-processor";

const app = express();
app.use(express.json());

// Track last activity for monitoring
let lastActivityTime = Date.now();

// Initialize clients
const telegramClient = new TelegramClient();
const sheetsClient = new SheetsClient();
const aiClientManager = new AIClientManager();
const userPreferences = initializeUserPreferences(sheetsClient);
const imageProcessor = new ImageProcessor(telegramClient);
const audioProcessor = new AudioProcessor(telegramClient);

// Initialize handlers
const messageHandlers = new MessageHandlers(
  aiClientManager,
  userPreferences,
  sheetsClient,
  imageProcessor,
  audioProcessor
);
const callbackHandlers = new CallbackHandlers(telegramClient, sheetsClient);
const conversationHandler = new ConversationHandler(messageHandlers);

// Wire up conversation handler to callback handlers
callbackHandlers.setConversationHandler(conversationHandler);

// Health check endpoint
app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Lightweight health endpoint for keep-awake services (UptimeRobot)
// This endpoint is specifically designed to be pinged every few minutes
// to prevent Render's free tier from putting the app to sleep
// We do actual work here to force Render to wake up the service
// Based on: https://sergeiliski.medium.com/how-to-run-a-full-time-app-on-renders-free-tier-without-it-sleeping-bec26776d0b9
app.get("/healthz", async (_req: Request, res: Response) => {
  try {
    const now = Date.now();
    const timeSinceLastActivity = now - lastActivityTime;
    lastActivityTime = now;

    // Force actual computation to prevent edge caching
    const randomData = Math.random() * 1000;

    // Try to verify Google Sheets connection (lightweight check)
    // This forces the app to actually wake up and load dependencies
    const sheetsConnected = sheetsClient ? true : false;

    // Ping Redis to force actual connection work and prevent service from sleeping
    // This is critical: doing real I/O ensures Render wakes up the service
    // Based on the article: https://sergeiliski.medium.com/how-to-run-a-full-time-app-on-renders-free-tier-without-it-sleeping-bec26776d0b9
    const redisStart = Date.now();
    const redisConnected = await sessionManager.ping();
    const redisLatency = Date.now() - redisStart;

    res.status(200).json({
      status: "ok",
      timestamp: now,
      uptime: process.uptime(),
      memory: process.memoryUsage().heapUsed,
      lastActivity: timeSinceLastActivity,
      random: randomData,
      sheets: sheetsConnected,
      redis: redisConnected,
      redisLatency: redisLatency,
    });
  } catch (error) {
    Logger.error("Health check error:", error instanceof Error ? error : null);
    res.status(500).json({
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

// Webhook endpoint
app.post("/webhook", async (req: Request, res: Response) => {
  try {
    lastActivityTime = Date.now();
    const update = req.body as TelegramUpdate;

    // Handle callback queries
    if (update.callback_query) {
      void callbackHandlers.handleCallback(update.callback_query).catch((error: unknown) => {
        Logger.error("Error handling callback", error instanceof Error ? error : null);
      });
      res.status(200).send("OK");
      return;
    }

    // Handle messages
    if (!update.message) {
      res.status(200).send("OK");
      return;
    }

    const message = update.message;
    const chatId = message.chat.id;

    // Security check
    const allowedChatIds = [config.telegram.chatId];
    if (config.telegram.partnerChatId) allowedChatIds.push(config.telegram.partnerChatId);
    if (!allowedChatIds.includes(chatId)) {
      Logger.log(`Unauthorized access attempt from: ${chatId}`);
      await telegramClient.sendMessage(chatId, "⛔ No tenés permiso para usar este bot.");
      res.status(200).send("OK");
      return;
    }

    // Handle commands
    if (message.text) {
      const handled = await dispatchCommand({
        chatId,
        text: message.text,
        telegramClient,
        sheetsClient,
        userPreferences,
      });
      if (handled) {
        res.status(200).send("OK");
        return;
      }
    }

    telegramClient.sendChatAction(chatId, "typing");

    await processIncomingMessage({
      message,
      chatId,
      telegramClient,
      messageHandlers,
      audioProcessor,
      aiClientManager,
      userPreferences,
    });

    res.status(200).send("OK");
  } catch (error) {
    Logger.error("Error in webhook handler", error instanceof Error ? error : null);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Start server
const PORT = config.server.port;

async function startServer() {
  try {
    // Connect to Redis
    Logger.log("Connecting to Redis...");
    await sessionManager.connect();
    Logger.log("Redis connected successfully");

    // Start Express server
    app.listen(PORT, () => {
      Logger.log(`Server running on port ${PORT}`);
      Logger.log(`Webhook URL: ${config.telegram.webhookUrl}/webhook`);
      Logger.log(`Health check endpoint: /healthz (ping this to keep app alive)`);
    });

    // Set webhook on startup (optional, can be done manually)
    if (config.telegram.webhookUrl) {
      telegramClient.setWebhook(`${config.telegram.webhookUrl}/webhook`).catch((error: unknown) => {
        Logger.error("Failed to set webhook", error instanceof Error ? error : null);
      });
    }
  } catch (error) {
    Logger.error("Failed to start server", error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on("SIGTERM", async () => {
  Logger.log("SIGTERM received, shutting down...");
  await sessionManager.disconnect();
  await pendingOperations.disconnect();
  process.exit(0);
});

process.on("SIGINT", async () => {
  Logger.log("SIGINT received, shutting down...");
  await sessionManager.disconnect();
  await pendingOperations.disconnect();
  process.exit(0);
});

void startServer();
