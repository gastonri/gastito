import { TelegramMessage, TransactionResult } from "../types";
import { TelegramClient } from "./telegram";
import { MessageHandlers } from "./handlers";
import { MessageBuilder } from "./message-builder";
import { AudioProcessor } from "../services/audio-processor";
import { AIClientManager } from "../ai/client";
import { UserPreferencesService } from "../services/user-preferences";
import { pendingOperations } from "../services/pending-operations";
import { sendProcessingError } from "./error-handler";

export interface MessageProcessorContext {
  message: TelegramMessage;
  chatId: number;
  telegramClient: TelegramClient;
  messageHandlers: MessageHandlers;
  audioProcessor: AudioProcessor;
  aiClientManager: AIClientManager;
  userPreferences: UserPreferencesService;
}

/** Checks if a single-result response is modifying an existing pending operation. */
function isModifyingPending(results: TransactionResult[], chatId: number): boolean {
  if (results.length !== 1) return false;
  const existingPending = pendingOperations.getLastPendingOperation(chatId);
  if (!existingPending) return false;

  const result = results[0];
  if (result.usa_contexto) return true;
  if (result.tipo === "GASTO" && result.datos.monto === existingPending.datos.monto) return true;

  return false;
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
  } = ctx;
  let loadingMessageId: number | null = null;

  try {
    let results: TransactionResult[] | undefined;

    if (message.photo) {
      loadingMessageId = await telegramClient.sendMessage(
        chatId,
        "📸 Paso 1/5: Iniciando análisis..."
      );
      await telegramClient.editMessage(
        chatId,
        loadingMessageId!,
        "📸 Paso 2/5: Descargando imagen de Telegram..."
      );

      results = await messageHandlers.handleImageMessage(message);

      await telegramClient.editMessage(
        chatId,
        loadingMessageId!,
        "📸 Paso 3/5: Preparando contexto..."
      );
      await telegramClient.editMessage(
        chatId,
        loadingMessageId!,
        "📸 Paso 4/5: Analizando con IA (esto puede tardar)..."
      );
      await telegramClient.editMessage(
        chatId,
        loadingMessageId!,
        "📸 Paso 5/5: Procesando resultados..."
      );
    } else if (message.voice || message.audio) {
      loadingMessageId = await telegramClient.sendMessage(
        chatId,
        "🎤 Paso 1/4: Transcribiendo audio..."
      );
      await telegramClient.editMessage(
        chatId,
        loadingMessageId!,
        "🎤 Paso 2/4: Descargando audio de Telegram..."
      );

      const audioFile = message.voice || message.audio!;
      const audioData = await audioProcessor.downloadAudio(audioFile.file_id);

      await telegramClient.editMessage(
        chatId,
        loadingMessageId!,
        "🎤 Paso 3/4: Transcribiendo con IA (esto puede tardar)..."
      );
      const userProvider = await userPreferences.getAIProvider(chatId);
      const aiClient = aiClientManager.getClient(userProvider);
      const textoTranscrito = await aiClient.transcribeAudio(audioData);

      if (!textoTranscrito || textoTranscrito.trim() === "") {
        throw new Error(
          "No se pudo transcribir el audio. Asegurate de que el audio sea claro y esté en español."
        );
      }

      await telegramClient.editMessage(
        chatId,
        loadingMessageId!,
        `🎤 *Transcripción:*\n\n"${textoTranscrito}"\n\nProcesando...`
      );
      results = await messageHandlers.handleTextMessage({ ...message, text: textoTranscrito });
    } else if (message.text) {
      loadingMessageId = await telegramClient.sendMessage(chatId, "💬 Procesando...");
      results = await messageHandlers.handleTextMessage(message);
    } else {
      await telegramClient.sendMessage(
        chatId,
        "❌ Solo puedo procesar texto, imágenes de comprobantes o audios."
      );
      return;
    }

    if (!results || results.length === 0) {
      throw new Error("No result from message handler");
    }

    const isModification = isModifyingPending(results, chatId);
    let operationId: string;

    if (isModification) {
      const updatedId = pendingOperations.updateLastPendingOperation(chatId, results[0]);
      operationId = updatedId || pendingOperations.createOperation(results, chatId);
    } else {
      operationId = pendingOperations.createOperation(results, chatId);
    }

    const keyboard = {
      inline_keyboard: [
        [
          { text: "✅ Confirmar", callback_data: `conf_${operationId}` },
          { text: "🗑️ Cancelar", callback_data: `cancel_${operationId}` },
        ],
      ],
    };

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
