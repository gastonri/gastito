import { sessionManager } from "../../services/session-manager";
import { contextManager } from "../../services/context-manager";
import { CommandHandler } from "./types";

export const handleReset: CommandHandler = async ({ chatId, telegramClient }) => {
  await sessionManager.deleteSession(chatId);
  contextManager.clearContext(chatId);
  await telegramClient.sendMessage(
    chatId,
    "🔄 *Contexto limpiado*\n\nEmpezando conversación nueva."
  );
};
