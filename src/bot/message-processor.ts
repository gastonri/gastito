import { TelegramMessage, TransactionResult } from "../types";
import { TelegramClient } from "./telegram";
import { MessageHandlers } from "./handlers";
import { MessageBuilder } from "./message-builder";
import { AudioProcessor } from "../services/audio-processor";
import { AIClientManager } from "../ai/client";
import { SheetsClient } from "../sheets/client";
import { Logger } from "../utils/logger";
import { UserPreferencesService } from "../services/user-preferences";
import { pendingOperations } from "../services/pending-operations";
import { sendProcessingError, UserFacingError } from "./error-handler";
import { Messages } from "./messages";
import { ClarificationBuilder } from "./clarification-builder";

export interface MessageProcessorContext {
  message: TelegramMessage;
  chatId: number;
  telegramClient: TelegramClient;
  messageHandlers: MessageHandlers;
  audioProcessor: AudioProcessor;
  aiClientManager: AIClientManager;
  userPreferences: UserPreferencesService;
  sheetsClient: SheetsClient;
}

/** Checks if a single-result response is modifying an existing pending operation. */
async function isModifyingPending(results: TransactionResult[], chatId: number): Promise<boolean> {
  if (results.length !== 1) return false;
  const existingPending = await pendingOperations.getLastPendingOperation(chatId);
  if (!existingPending) return false;

  const result = results[0];
  if (result.usa_contexto) return true;
  if (result.tipo === existingPending.tipo && result.datos.monto === existingPending.datos.monto)
    return true;

  return false;
}

/** Marks expenses that already exist in the sheet. Best effort: never blocks the flow. */
async function flagDuplicates(
  results: TransactionResult[],
  sheetsClient: SheetsClient
): Promise<void> {
  for (const result of results) {
    if (result.tipo !== "GASTO") continue;
    try {
      result.duplicado = await sheetsClient.findDuplicateGasto(result.datos);
    } catch (error) {
      Logger.warn(
        `Duplicate check skipped: ${error instanceof Error ? error.message : String(error)}`
      );
      return;
    }
  }
}

/**
 * Routes an incoming message (photo, voice/audio, or text) to the right handler,
 * then creates a pending operation and sends the confirmation prompt.
 * Any error along the way is reported to the user via sendProcessingError
 * instead of being rethrown, so the webhook can always respond 200 to Telegram.
 */
export async function processIncomingMessage(ctx: MessageProcessorContext): Promise<void> {
  const {
    message,
    chatId,
    telegramClient,
    messageHandlers,
    audioProcessor,
    aiClientManager,
    userPreferences,
    sheetsClient,
  } = ctx;
  let loadingMessageId: number | null = null;

  try {
    let results: TransactionResult[] | undefined;

    if (message.photo) {
      loadingMessageId = await telegramClient.sendMessage(chatId, Messages.loadingPhoto);
      results = await messageHandlers.handleImageMessage(message);
    } else if (message.voice || message.audio) {
      loadingMessageId = await telegramClient.sendMessage(chatId, Messages.loadingAudio);

      const audioFile = message.voice || message.audio!;
      const audioData = await audioProcessor.downloadAudio(audioFile.file_id);

      const userProvider = await userPreferences.getAIProvider(chatId);
      const aiClient = aiClientManager.getClient(userProvider);
      const textoTranscrito = await aiClient.transcribeAudio(audioData);

      if (!textoTranscrito || textoTranscrito.trim() === "") {
        throw new UserFacingError(Messages.transcriptionFailed);
      }

      await telegramClient.editMessage(
        chatId,
        loadingMessageId!,
        Messages.transcription(textoTranscrito)
      );
      results = await messageHandlers.handleTextMessage({ ...message, text: textoTranscrito });
    } else if (message.text) {
      loadingMessageId = await telegramClient.sendMessage(chatId, Messages.loadingText);
      results = await messageHandlers.handleTextMessage(message);
    } else {
      await telegramClient.sendMessage(chatId, Messages.unsupportedMessage);
      return;
    }

    if (!results || results.length === 0) {
      throw new Error("No result from message handler");
    }

    await flagDuplicates(results, sheetsClient);

    const isModification = await isModifyingPending(results, chatId);
    let operationId: string;

    if (isModification) {
      operationId = await pendingOperations.updateLastPendingOperation(chatId, results[0]);
    } else {
      operationId = await pendingOperations.createOperation(results, chatId);
    }

    const keyboard = ClarificationBuilder.buildConfirmCancelKeyboard(operationId);

    const confirmationMessage =
      results.length === 1
        ? MessageBuilder.buildConfirmationMessage(results[0])
        : MessageBuilder.buildMultiConfirmationMessage(results);

    if (loadingMessageId) {
      await telegramClient.editMessage(chatId, loadingMessageId, confirmationMessage, keyboard);
    } else {
      await telegramClient.sendMessage(chatId, confirmationMessage, keyboard);
    }
  } catch (error) {
    await sendProcessingError(chatId, error, loadingMessageId, telegramClient);
  }
}
