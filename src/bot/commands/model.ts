import { Logger } from "../../utils/logger";
import { CommandHandler } from "./types";

export const handleModel: CommandHandler = async ({
  chatId,
  text,
  telegramClient,
  userPreferences,
}) => {
  const parts = text.trim().split(/\s+/);

  if (parts.length === 1) {
    const currentProvider = await userPreferences.getAIProvider(chatId);
    const providerName = currentProvider === "gemini" ? "Gemini" : "Anthropic Claude";
    await telegramClient.sendMessage(
      chatId,
      "🤖 *Modelo actual:* " +
        providerName +
        "\n\nUsá `/model gemini` o `/model anthropic` para cambiar."
    );
    return;
  }

  const requestedProvider = parts[1].toLowerCase().trim();
  if (requestedProvider !== "gemini" && requestedProvider !== "anthropic") {
    await telegramClient.sendMessage(
      chatId,
      "❌ Modelo inválido. Usá `gemini` o `anthropic`.\n\nEjemplo: `/model gemini`"
    );
    return;
  }

  try {
    await userPreferences.setAIProvider(chatId, requestedProvider);
    const providerName = requestedProvider === "gemini" ? "Gemini" : "Anthropic Claude";
    await telegramClient.sendMessage(
      chatId,
      `✅ *Modelo cambiado a:* ${providerName}\n\nEste cambio se aplicará en los próximos mensajes.`
    );
  } catch (error) {
    Logger.error("Error setting AI provider", error);
    await telegramClient.sendMessage(
      chatId,
      `❌ Error al cambiar el modelo: ${error instanceof Error ? error.message : String(error)}`
    );
  }
};
