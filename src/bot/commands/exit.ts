import { sessionManager } from "../../services/session-manager";
import { contextManager } from "../../services/context-manager";
import { CommandHandler } from "./types";

export const handleExit: CommandHandler = async ({ chatId, telegramClient }) => {
  await sessionManager.deleteSession(chatId);
  contextManager.clearContext(chatId);
  await telegramClient.sendMessage(
    chatId,
    "👋 *Sesión terminada*\n\nPodés empezar de nuevo cuando quieras."
  );
};
