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

export type ErrorKind =
  | "user_facing"
  | "quota"
  | "no_transaction"
  | "network"
  | "ai_high_demand"
  | "ai_model_unavailable"
  | "ai_other"
  | "unknown";

/** Classifies an error so logs can be filtered by cause (`kind=`) and the message chosen. */
export function classifyError(error: unknown): ErrorKind {
  if (error instanceof UserFacingError) return "user_facing";
  if (!(error instanceof Error)) return "unknown";
  const msg = error.message;

  if (/429|RESOURCE_EXHAUSTED|quota/i.test(msg)) return "quota";
  if (/No result from message handler/i.test(msg)) return "no_transaction";
  if (/ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|timeout|network|socket hang up/i.test(msg)) {
    return "network";
  }
  if (/high demand|UNAVAILABLE|overloaded|"code":\s*50[023]/i.test(msg)) return "ai_high_demand";
  if (
    /NOT_FOUND|no longer available|"code":\s*404|API key not valid|UNAUTHENTICATED|PERMISSION_DENIED|"code":\s*40[13]/i.test(
      msg
    )
  ) {
    return "ai_model_unavailable";
  }
  if (/gemini|generativelanguage|\b5\d\d\b/i.test(msg)) return "ai_other";
  return "unknown";
}

/** Maps any thrown error to a human-friendly message. Technical details only go to the logs. */
export function toUserMessage(error: unknown): string {
  switch (classifyError(error)) {
    case "user_facing":
      return (error as UserFacingError).message;
    case "quota": {
      const retryMatch = (error as Error).message.match(/retry in ([\d.]+)s/i);
      return retryMatch
        ? Messages.quotaExceededRetry(Math.ceil(parseFloat(retryMatch[1])))
        : Messages.quotaExceeded;
    }
    case "no_transaction":
      return Messages.noTransactionFound;
    case "network":
      return Messages.networkError;
    case "ai_high_demand":
      return Messages.aiHighDemand;
    case "ai_model_unavailable":
      return Messages.aiModelUnavailable;
    case "ai_other":
      return Messages.aiUnavailable;
    default:
      return Messages.genericError;
  }
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
