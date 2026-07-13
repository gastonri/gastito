import { Logger } from "../utils/logger";
import { TelegramClient } from "./telegram";

/**
 * Formats and sends a user-facing error message after message processing fails.
 * Detects Gemini rate-limit errors to show a friendlier, actionable message.
 */
export async function sendProcessingError(
  chatId: number,
  error: unknown,
  loadingMessageId: number | null,
  telegramClient: TelegramClient
): Promise<void> {
  Logger.error("Error processing message", error instanceof Error ? error : null);

  let errorText = "❌ Error en procesamiento";

  if (error instanceof Error) {
    if (
      error.message.includes("429") ||
      error.message.includes("RESOURCE_EXHAUSTED") ||
      error.message.includes("quota")
    ) {
      const retryMatch = error.message.match(/retry in ([\d.]+)s/i);
      const retrySeconds = retryMatch ? Math.ceil(parseFloat(retryMatch[1])) : null;

      errorText = retrySeconds
        ? `⚠️ *Límite de cuota alcanzado*\n\nHas excedido el límite diario de la API de Gemini (20 solicitudes/día en el plan gratuito).\n\nPor favor, intentá de nuevo en ${retrySeconds} segundos.\n\n💡 *Sugerencia:* Considerá actualizar a un plan de pago para aumentar el límite.`
        : `⚠️ *Límite de cuota alcanzado*\n\nHas excedido el límite diario de la API de Gemini (20 solicitudes/día en el plan gratuito).\n\nPor favor, intentá mañana o actualizá tu plan.`;
    } else {
      // For other errors, show a truncated, safe message
      const safeMessage = error.message.substring(0, 200).replace(/[*_`[\]]/g, "");
      errorText = `❌ Error:\n${safeMessage}`;
    }
  }

  // Telegram messages have a 4096 character limit, ensure we don't exceed it
  if (errorText.length > 4000) {
    errorText = errorText.substring(0, 4000) + "...";
  }

  try {
    if (loadingMessageId) {
      await telegramClient.editMessage(chatId, loadingMessageId, errorText);
    } else {
      await telegramClient.sendMessage(chatId, errorText);
    }
  } catch (telegramError) {
    // If editing fails, try sending a new message
    Logger.error(
      "Error sending error message to Telegram",
      telegramError instanceof Error ? telegramError : null
    );
    try {
      await telegramClient.sendMessage(
        chatId,
        "❌ Ocurrió un error al procesar tu mensaje. Por favor, intentá de nuevo."
      );
    } catch (finalError) {
      Logger.error(
        "Failed to send fallback error message",
        finalError instanceof Error ? finalError : null
      );
    }
  }
}
