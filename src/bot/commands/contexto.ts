import { contextManager } from "../../services/context-manager";
import { MessageBuilder } from "../message-builder";
import { CommandHandler } from "./types";

export const handleContexto: CommandHandler = async ({ chatId, telegramClient }) => {
  const contextoPrevio = contextManager.getContext(chatId);
  if (contextoPrevio) {
    const resumen = MessageBuilder.buildContextSummary(contextoPrevio);
    await telegramClient.sendMessage(chatId, `📋 *Último registro confirmado:*\n\n${resumen}`);
  } else {
    await telegramClient.sendMessage(
      chatId,
      "📋 No hay contexto previo. Empezá una nueva conversación."
    );
  }
};
