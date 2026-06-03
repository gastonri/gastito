import { TelegramCallbackQuery, TransactionResult } from "../types";
import { TelegramClient } from "./telegram";
import { SheetsClient } from "../sheets/client";
import { Validator } from "../services/validator";
import { pendingOperations } from "../services/pending-operations";
import { contextManager } from "../services/context-manager";
import { sessionManager } from "../services/session-manager";
import { ConversationHandler } from "../services/conversation-handler";
import { ClarificationBuilder } from "./clarification-builder";
import { MessageBuilder } from "./message-builder";
import { Logger } from "../utils/logger";
import { getErrorMessage } from "../utils/text";

export class CallbackHandlers {
  private conversationHandler: ConversationHandler | null = null;

  constructor(
    private telegramClient: TelegramClient,
    private sheetsClient: SheetsClient
  ) {}

  setConversationHandler(handler: ConversationHandler): void {
    this.conversationHandler = handler;
  }

  async handleCallback(callback: TelegramCallbackQuery): Promise<void> {
    const chatId = callback.message.chat.id;
    const messageId = callback.message.message_id;
    const data = callback.data;

    if (data.startsWith("conf_")) {
      await this.handleConfirm(callback.id, chatId, messageId, data);
    } else if (data.startsWith("cancel_")) {
      await this.handleCancel(callback.id, chatId, messageId, data);
    } else if (data.startsWith("cl_")) {
      await this.handleClarification(callback.id, chatId, messageId, data);
    }
  }

  private async handleConfirm(
    callbackId: string,
    chatId: number,
    messageId: number,
    data: string
  ): Promise<void> {
    const operationId = data.replace("conf_", "");
    const storedData = pendingOperations.getOperation(operationId);

    if (!storedData) {
      await this.telegramClient.editMessage(
        chatId,
        messageId,
        "⏱️ Esta operación expiró. Enviá de nuevo el mensaje."
      );
      await this.telegramClient.answerCallbackQuery(callbackId, "Operación expirada");
      return;
    }

    try {
      Logger.log("Attempting to write data: " + JSON.stringify(storedData));

      // Validate transaction
      Validator.validateTransaction(storedData);

      // Write to sheet
      await this.sheetsClient.writeGasto(storedData.datos);
    } catch (error) {
      Logger.error("ERROR writing to sheet from callback", error);
      await this.sendSaveError(chatId, messageId, callbackId, error);
      return;
    }

    // These are useful for follow-up UX, but the transaction is already saved.
    pendingOperations.deleteOperation(operationId);

    contextManager.setContext(chatId, {
      tipo: storedData.tipo,
      datos: storedData.datos,
    });

    try {
      await sessionManager.saveLastConfirmed(chatId, storedData);
      await sessionManager.deleteSession(chatId);
    } catch (error) {
      Logger.warn(
        `Transaction was saved but session cleanup failed for chat ${chatId}: ${getErrorMessage(error)}`
      );
    }

    const resumen = this.generateResumen(storedData);
    await this.sendSaveSuccess(chatId, messageId, callbackId, resumen);
  }

  private async handleCancel(
    callbackId: string,
    chatId: number,
    messageId: number,
    data: string
  ): Promise<void> {
    const operationId = data.replace("cancel_", "");
    pendingOperations.deleteOperation(operationId);

    // Delete session (explicit termination)
    await sessionManager.deleteSession(chatId);

    await this.telegramClient.editMessage(
      chatId,
      messageId,
      "🗑️ *Operación cancelada*\n\nNo se guardó nada."
    );
    await this.telegramClient.answerCallbackQuery(callbackId, "Cancelado");
  }

  private async handleClarification(
    callbackId: string,
    chatId: number,
    messageId: number,
    data: string
  ): Promise<void> {
    if (!this.conversationHandler) {
      Logger.warn("ConversationHandler not set for clarification callback");
      await this.telegramClient.answerCallbackQuery(callbackId, "Error interno");
      return;
    }

    const parsed = ClarificationBuilder.parseCallbackData(data);
    if (!parsed) {
      Logger.warn(`Invalid clarification callback data: ${data}`);
      await this.telegramClient.answerCallbackQuery(callbackId, "Error");
      return;
    }

    const session = await sessionManager.getSession(chatId);
    if (!session || !session.pendingQuestions) {
      await this.telegramClient.answerCallbackQuery(
        callbackId,
        "Sesión expirada"
      );
      await this.telegramClient.editMessage(
        chatId,
        messageId,
        "⏱️ Tu sesión expiró. Por favor, empezá de nuevo."
      );
      return;
    }

    // Find the question being answered
    const question = ClarificationBuilder.findQuestionByPrefix(
      session.pendingQuestions,
      parsed.questionIdPrefix
    );

    if (!question) {
      Logger.warn(`Question not found for prefix: ${parsed.questionIdPrefix}`);
      await this.telegramClient.answerCallbackQuery(callbackId, "Error");
      return;
    }

    // Process the clarification response
    const result = await this.conversationHandler.handleClarificationButtonResponse(
      chatId,
      question.id,
      parsed.value
    );

    await this.telegramClient.answerCallbackQuery(
      callbackId,
      `✓ ${parsed.value}`
    );

    // Handle the result
    if (result.type === "transaction" && result.response?.responseType === "transaction") {
      // We have a complete transaction now, show confirmation
      const confirmMessage = MessageBuilder.buildConfirmationMessage(
        result.response.transaction
      );
      const keyboard = ClarificationBuilder.buildConfirmCancelKeyboard(
        session.lastOperationId || session.sessionId
      );

      await this.telegramClient.editMessage(chatId, messageId, confirmMessage, keyboard);
    } else if (result.type === "clarification" && result.response?.responseType === "clarification") {
      // Still need more clarification
      const { text, keyboard } = ClarificationBuilder.buildClarificationMessage(
        result.response
      );
      await this.telegramClient.editMessage(chatId, messageId, text, keyboard || undefined);
    } else if (result.type === "error") {
      await this.telegramClient.editMessage(
        chatId,
        messageId,
        `❌ ${result.message || "Ocurrió un error"}`
      );
    }
  }

  private generateResumen(data: TransactionResult): string {
    const d = data.datos;
    return `📝 ${d.descripcion} - $${d.monto}\n🏷️ ${d.macro_categoria} → ${d.subcategoria}`;
  }

  private async sendOrEditMessage(chatId: number, messageId: number, text: string): Promise<void> {
    try {
      await this.telegramClient.editMessage(chatId, messageId, text);
    } catch {
      Logger.warn(`Could not edit message for chat ${chatId}, sending a new message instead`);
      await this.telegramClient.sendMessage(chatId, text);
    }
  }

  private async sendSaveSuccess(
    chatId: number,
    messageId: number,
    callbackId: string,
    resumen: string
  ): Promise<void> {
    await this.sendOrEditMessage(chatId, messageId, "✅ *¡Anotado perfectamente!*\n\n" + resumen);

    try {
      await this.telegramClient.answerCallbackQuery(callbackId, "✓ Guardado");
    } catch (error) {
      Logger.warn(`Could not answer callback query after successful save: ${getErrorMessage(error)}`);
    }
  }

  private async sendSaveError(
    chatId: number,
    messageId: number,
    callbackId: string,
    error: unknown
  ): Promise<void> {
    const errorMessage = getErrorMessage(error);
    await this.sendOrEditMessage(
      chatId,
      messageId,
      "❌ *Error al guardar*\n\n" + errorMessage + "\n\nRevisá los logs para más detalles."
    );

    try {
      await this.telegramClient.answerCallbackQuery(callbackId, "Error: " + errorMessage);
    } catch (callbackError) {
      Logger.warn(`Could not answer callback query after save error: ${getErrorMessage(callbackError)}`);
    }
  }
}
