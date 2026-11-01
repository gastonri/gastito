import { Logger } from "../utils/logger";
import { TelegramClient } from "./telegram";
import { Messages } from "./messages";

/** An error whose message is already safe and friendly to show to the user as-is. */
export class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserFacingError";
  }
}

/** Maps any thrown error to a human-friendly message. Technical details only go to the logs. */
export function toUserMessage(error: unknown): string {
  if (error instanceof UserFacingError) return error.message;
  if (!(error instanceof Error)) return Messages.genericError;

  const msg = error.message;

  if (/429|RESOURCE_EXHAUSTED|quota/i.test(msg)) {
    const retryMatch = msg.match(/retry in ([\d.]+)s/i);
    return retryMatch
      ? Messages.quotaExceededRetry(Math.ceil(parseFloat(retryMatch[1])))
      : Messages.quotaExceeded;
  }

  if (/No result from message handler/i.test(msg)) return Messages.noTransactionFound;

  if (/ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|timeout|network|socket hang up/i.test(msg)) {
    return Messages.networkError;
  }

  if (/gemini|generativelanguage|\b5\d\d\b|overloaded|unavailable/i.test(msg)) {
    return Messages.aiUnavailable;
  }

  return Messages.genericError;
}

/**
 * Formats and sends a user-facing error message after message processing fails.
 * The raw error is logged; the user only sees a friendly, actionable message.
 */
export async function sendProcessingError(
  chatId: number,
  error: unknown,
  loadingMessageId: number | null,
  telegramClient: TelegramClient
): Promise<void> {
  Logger.error("Error processing message", error instanceof Error ? error : null);

  let errorText = toUserMessage(error);

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
      await telegramClient.sendMessage(chatId, Messages.genericError);
    } catch (finalError) {
      Logger.error(
        "Failed to send fallback error message",
        finalError instanceof Error ? finalError : null
      );
    }
  }
}
