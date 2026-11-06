import { TelegramMessage, TransactionResult } from "../types";
import { TelegramClient } from "./telegram";
import { MessageHandlers } from "./handlers";
import { AudioProcessor } from "../services/audio-processor";
import { AIClientManager } from "../ai/client";
import { SheetsClient } from "../sheets/client";
import { Logger } from "../utils/logger";
import { UserPreferencesService } from "../services/user-preferences";
import { pendingOperations } from "../services/pending-operations";
import { sendProcessingError, UserFacingError, isRetryable } from "./error-handler";
import { failedMessages } from "../services/failed-messages";
import { ClarificationBuilder } from "./clarification-builder";
import { Messages } from "./messages";
import { createTimings } from "../utils/timings";
import { classifyError } from "./error-handler";
import { animateLoading } from "./loading-animation";
import { attachTipoCambio, renderConfirmation } from "./confirmation";

/** Phases are logged as `<phase>_ms`; anything over the threshold is flagged `slow=true`. */
const SLOW_MS = 15000;
function logMessageEvent(name: string, fields: Record<string, string | number>): void {
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(fields)) {
    out[typeof v === "number" && k !== "items" && k !== "total_ms" ? `${k}_ms` : k] = v;
  }
  out.slow = typeof fields.total_ms === "number" && fields.total_ms > SLOW_MS;
  Logger.event(name, out);
}

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
  const timings = createTimings();
  const kind = message.photo ? "photo" : message.voice || message.audio ? "voice" : "text";
  let items = 0;
  let loadingMessageId: number | null = null;
  let stopAnimation: () => Promise<void> = async () => {};
  const startLoading = async (text: string) => {
    loadingMessageId = await telegramClient.sendMessage(chatId, text);
    if (loadingMessageId) {
      stopAnimation = animateLoading(telegramClient, chatId, loadingMessageId, text);
    }
  };

  try {
    let results: TransactionResult[] | undefined;

    if (message.photo) {
      await startLoading(Messages.loadingPhoto);
      results = await messageHandlers.handleImageMessage(message);
    } else if (message.voice || message.audio) {
      await startLoading(Messages.loadingAudio);

      const audioFile = message.voice || message.audio!;
      const audioData = await audioProcessor.downloadAudio(audioFile.file_id);

      const userProvider = await userPreferences.getAIProvider(chatId);
      const aiClient = aiClientManager.getClient(userProvider);
      const textoTranscrito = await aiClient.transcribeAudio(audioData);

      if (!textoTranscrito || textoTranscrito.trim() === "") {
        throw new UserFacingError(Messages.transcriptionFailed);
      }

      await stopAnimation();
      await telegramClient.editMessage(
        chatId,
        loadingMessageId!,
        Messages.transcription(textoTranscrito)
      );
      results = await messageHandlers.handleTextMessage({ ...message, text: textoTranscrito });
    } else if (message.text) {
      await startLoading(Messages.loadingText);
      results = await messageHandlers.handleTextMessage(message);
    } else {
      await telegramClient.sendMessage(chatId, Messages.unsupportedMessage);
      return;
    }

    await stopAnimation();
    timings.mark("ai");
    items = results?.length ?? 0;

    if (!results || results.length === 0) {
      throw new Error("No result from message handler");
    }

    await flagDuplicates(results, sheetsClient);
    await attachTipoCambio(results, sheetsClient);

    timings.mark("checks");

    const isModification = await isModifyingPending(results, chatId);
    let operationId: string;

    if (isModification) {
      operationId = await pendingOperations.updateLastPendingOperation(chatId, results[0]);
    } else {
      operationId = await pendingOperations.createOperation(results, chatId);
    }

    timings.mark("pending");

    const { text: confirmationMessage, keyboard } = renderConfirmation(results, operationId);

    if (loadingMessageId) {
      await telegramClient.editMessage(chatId, loadingMessageId, confirmationMessage, keyboard);
    } else {
      await telegramClient.sendMessage(chatId, confirmationMessage, keyboard);
    }
    timings.mark("telegram");
    logMessageEvent("msg_done", { kind, items, ...timings.phases(), total_ms: timings.total() });
  } catch (error) {
    await stopAnimation();
    logMessageEvent("msg_failed", {
      kind,
      error_kind: classifyError(error),
      ...timings.phases(),
      total_ms: timings.total(),
    });
    const keyboard = isRetryable(error)
      ? ClarificationBuilder.buildRetryMessageKeyboard(failedMessages.save(message))
      : undefined;
    await sendProcessingError(chatId, error, loadingMessageId, telegramClient, keyboard);
  }
}
