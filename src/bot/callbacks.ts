import { TelegramCallbackQuery } from "../types";
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
import { formatMoney } from "../utils/format";
import { Messages } from "./messages";
import { attachTipoCambio, renderConfirmation, toggleDolar } from "./confirmation";
import type { InlineKeyboardMarkup } from "./clarification-builder";
import type { WrittenRow } from "../types";

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
    } else if (data.startsWith("fx_")) {
      await this.handleFx(callback.id, chatId, messageId, data);
    } else if (data.startsWith("edit_")) {
      await this.handleEdit(callback.id, chatId, data);
    } else if (data.startsWith("dz_")) {
      await this.handleDanger(callback.id, chatId, messageId, data);
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
    const storedData = await pendingOperations.getOperation(operationId);

    if (!storedData) {
      await this.telegramClient.editMessage(chatId, messageId, Messages.operationExpired);
      await this.telegramClient.answerCallbackQuery(callbackId, Messages.operationExpiredToast);
      return;
    }

    Logger.log("Attempting to write data: " + JSON.stringify(storedData));

    const saved: typeof storedData = [];
    const written: WrittenRow[] = [];
    const failed: { gasto: (typeof storedData)[0]; error: unknown }[] = [];

    for (const gasto of storedData) {
      try {
        Validator.validateTransaction(gasto);
        const row =
          gasto.tipo === "INGRESO"
            ? await this.sheetsClient.writeIngreso(gasto.datos)
            : await this.sheetsClient.writeGasto(gasto.datos);
        written.push(row);
        saved.push(gasto);
      } catch (error) {
        Logger.error("ERROR writing gasto to sheet", error);
        failed.push({ gasto, error });
      }
    }

    if (saved.length === 0) {
      await this.sendSaveError(chatId, messageId, callbackId, operationId, failed[0].error);
      return;
    }

    await pendingOperations.deleteOperation(operationId);

    contextManager.setContext(chatId, {
      tipo: saved[saved.length - 1].tipo,
      datos: saved[saved.length - 1].datos,
    });

    try {
      await sessionManager.saveLastBatch(chatId, written);
      await sessionManager.saveLastConfirmed(chatId, saved[saved.length - 1]);
      await sessionManager.deleteSession(chatId);
    } catch (error) {
      Logger.warn(
        `Transaction was saved but session cleanup failed for chat ${chatId}: ${getErrorMessage(error)}`
      );
    }

    let successMessage = MessageBuilder.buildSuccessMessage(saved, failed.length);
    const budgetNote = await this.buildBudgetNote(saved);
    if (budgetNote) successMessage += `\n\n${budgetNote}`;
    await this.sendSaveSuccess(chatId, messageId, callbackId, successMessage);
  }

  private async handleCancel(
    callbackId: string,
    chatId: number,
    messageId: number,
    data: string
  ): Promise<void> {
    const operationId = data.replace("cancel_", "");
    await pendingOperations.deleteOperation(operationId);

    // Delete session (explicit termination)
    await sessionManager.deleteSession(chatId);

    await this.telegramClient.editMessage(chatId, messageId, Messages.cancelled);
    await this.telegramClient.answerCallbackQuery(callbackId, Messages.cancelledToast);
  }

  /** Switches the pending USD expense(s) between dólar tarjeta and dólar blue. */
  private async handleFx(
    callbackId: string,
    chatId: number,
    messageId: number,
    data: string
  ): Promise<void> {
    const operationId = data.replace("fx_", "");
    const stored = await pendingOperations.getOperation(operationId);

    if (!stored) {
      await this.telegramClient.editMessage(chatId, messageId, Messages.operationExpired);
      await this.telegramClient.answerCallbackQuery(callbackId, Messages.operationExpiredToast);
      return;
    }

    toggleDolar(stored);
    await attachTipoCambio(stored, this.sheetsClient);
    await pendingOperations.setOperationData(operationId, stored);

    const { text, keyboard } = renderConfirmation(stored, operationId);
    await this.sendOrEditMessage(chatId, messageId, text, keyboard);

    const tipo = stored.find((r) => r.datos.cotizacion)?.datos.cotizacion === "BLUE" ? "blue" : "tarjeta";
    await this.telegramClient.answerCallbackQuery(callbackId, Messages.fxChangedToast(tipo));
  }

  private async handleEdit(callbackId: string, chatId: number, data: string): Promise<void> {
    const operationId = data.replace("edit_", "");
    const exists = await pendingOperations.getOperation(operationId);

    if (!exists) {
      await this.telegramClient.answerCallbackQuery(callbackId, Messages.operationExpiredToast);
      await this.telegramClient.sendMessage(chatId, Messages.operationExpired);
      return;
    }

    await this.telegramClient.answerCallbackQuery(callbackId, Messages.editToast);
    await this.telegramClient.sendMessage(chatId, Messages.editHint);
  }

  private async handleDanger(
    callbackId: string,
    chatId: number,
    messageId: number,
    data: string
  ): Promise<void> {
    if (data === "dz_undo") {
      await this.handleUndo(callbackId, chatId, messageId);
      return;
    }

    if (data === "dz_reset" || data === "dz_exit") {
      await sessionManager.deleteSession(chatId);
      contextManager.clearContext(chatId);
      await this.sendOrEditMessage(
        chatId,
        messageId,
        data === "dz_reset" ? Messages.resetDone : Messages.exitDone
      );
      await this.telegramClient.answerCallbackQuery(callbackId, "Listo");
      return;
    }

    await this.sendOrEditMessage(chatId, messageId, Messages.dangerAborted);
    await this.telegramClient.answerCallbackQuery(callbackId, Messages.dangerAbortedToast);
  }

  private async handleUndo(callbackId: string, chatId: number, messageId: number): Promise<void> {
    const batch = await sessionManager.getLastBatch(chatId);
    if (!batch || batch.length === 0) {
      await this.sendOrEditMessage(chatId, messageId, Messages.undoNothing);
      await this.telegramClient.answerCallbackQuery(callbackId, Messages.dangerAbortedToast);
      return;
    }

    let deleted = 0;
    let skipped = 0;
    try {
      // Delete bottom-up so earlier row numbers stay valid after each deletion.
      for (const written of [...batch].sort((a, b) => b.row - a.row)) {
        const result = await this.sheetsClient.deleteWrittenRow(written);
        if (result === "deleted") deleted++;
        else skipped++;
      }
    } catch (error) {
      Logger.error(`Undo failed for chat ${chatId}: ${getErrorMessage(error)}`);
      await this.sendOrEditMessage(chatId, messageId, Messages.undoFailed);
      await this.telegramClient.answerCallbackQuery(callbackId, Messages.saveFailedToast);
      return;
    }

    await sessionManager.clearLastBatch(chatId);
    await sessionManager.clearLastConfirmed(chatId);
    contextManager.clearContext(chatId);

    let text = deleted > 0 ? Messages.undoDone(deleted) : Messages.undoFailed;
    if (skipped > 0) text += `\n\n${Messages.undoPartial(deleted, skipped)}`;
    await this.sendOrEditMessage(chatId, messageId, text);
    await this.telegramClient.answerCallbackQuery(callbackId, Messages.undoToast);
  }

  /**
   * Best-effort budget progress for the categories just saved. Never throws:
   * a failure here must not affect the success message.
   */
  private async buildBudgetNote(
    saved: { tipo: string; datos: { macro_categoria?: string } }[]
  ): Promise<string> {
    try {
      const categorias = [
        ...new Set(
          saved
            .filter((g) => g.tipo === "GASTO" && g.datos.macro_categoria)
            .map((g) => g.datos.macro_categoria as string)
        ),
      ];
      if (categorias.length === 0) return "";

      const presupuestos = await this.sheetsClient.getPresupuestos();
      const relevantes = presupuestos.filter((p) => categorias.includes(p.macro_categoria));
      if (relevantes.length === 0) return "";

      const now = new Date();
      const gastos = await this.sheetsClient.getGastosDelMes(now.getFullYear(), now.getMonth() + 1);

      return relevantes
        .filter((p) => p.monto > 0)
        .map((p) => {
          const gastado = gastos
            .filter((g) => g.macro_categoria === p.macro_categoria)
            .reduce((sum, g) => sum + g.monto, 0);
          const pct = Math.round((gastado / p.monto) * 100);
          return Messages.budgetLine(
            p.macro_categoria,
            pct,
            formatMoney(gastado),
            formatMoney(p.monto)
          );
        })
        .join("\n");
    } catch (error) {
      Logger.warn(`Could not build budget note: ${getErrorMessage(error)}`);
      return "";
    }
  }

  private async handleClarification(
    callbackId: string,
    chatId: number,
    messageId: number,
    data: string
  ): Promise<void> {
    if (!this.conversationHandler) {
      Logger.warn("ConversationHandler not set for clarification callback");
      await this.telegramClient.answerCallbackQuery(callbackId, Messages.internalErrorToast);
      return;
    }

    const parsed = ClarificationBuilder.parseCallbackData(data);
    if (!parsed) {
      Logger.warn(`Invalid clarification callback data: ${data}`);
      await this.telegramClient.answerCallbackQuery(callbackId, Messages.internalErrorToast);
      return;
    }

    const session = await sessionManager.getSession(chatId);
    if (!session || !session.pendingQuestions) {
      await this.telegramClient.answerCallbackQuery(callbackId, Messages.sessionExpiredToast);
      await this.telegramClient.editMessage(chatId, messageId, Messages.sessionExpired);
      return;
    }

    // Find the question being answered
    const question = ClarificationBuilder.findQuestionByPrefix(
      session.pendingQuestions,
      parsed.questionIdPrefix
    );

    if (!question) {
      Logger.warn(`Question not found for prefix: ${parsed.questionIdPrefix}`);
      await this.telegramClient.answerCallbackQuery(callbackId, Messages.internalErrorToast);
      return;
    }

    // Process the clarification response
    const result = await this.conversationHandler.handleClarificationButtonResponse(
      chatId,
      question.id,
      parsed.value
    );

    await this.telegramClient.answerCallbackQuery(callbackId, `✓ ${parsed.value}`);

    // Handle the result
    if (result.type === "transaction" && result.response?.responseType === "transaction") {
      // We have a complete transaction now, show confirmation
      const confirmMessage = MessageBuilder.buildConfirmationMessage(result.response.transaction);
      const keyboard = ClarificationBuilder.buildConfirmCancelKeyboard(
        session.lastOperationId || session.sessionId
      );

      await this.telegramClient.editMessage(chatId, messageId, confirmMessage, keyboard);
    } else if (
      result.type === "clarification" &&
      result.response?.responseType === "clarification"
    ) {
      // Still need more clarification
      const { text, keyboard } = ClarificationBuilder.buildClarificationMessage(result.response);
      await this.telegramClient.editMessage(chatId, messageId, text, keyboard || undefined);
    } else if (result.type === "error") {
      await this.telegramClient.editMessage(chatId, messageId, Messages.clarificationError);
    }
  }

  private async sendOrEditMessage(
    chatId: number,
    messageId: number,
    text: string,
    keyboard?: InlineKeyboardMarkup
  ): Promise<void> {
    try {
      await this.telegramClient.editMessage(chatId, messageId, text, keyboard);
    } catch {
      Logger.warn(`Could not edit message for chat ${chatId}, sending a new message instead`);
      await this.telegramClient.sendMessage(chatId, text, keyboard);
    }
  }

  private async sendSaveSuccess(
    chatId: number,
    messageId: number,
    callbackId: string,
    successMessage: string
  ): Promise<void> {
    await this.sendOrEditMessage(chatId, messageId, successMessage);

    try {
      await this.telegramClient.answerCallbackQuery(callbackId, Messages.saved);
    } catch (error) {
      Logger.warn(
        `Could not answer callback query after successful save: ${getErrorMessage(error)}`
      );
    }
  }

  private async sendSaveError(
    chatId: number,
    messageId: number,
    callbackId: string,
    operationId: string,
    error: unknown
  ): Promise<void> {
    // Technical details stay in the logs; the pending operation is kept so the user can retry.
    Logger.error(`Save failed for operation ${operationId}: ${getErrorMessage(error)}`);

    await this.sendOrEditMessage(
      chatId,
      messageId,
      Messages.saveFailed,
      ClarificationBuilder.buildRetryKeyboard(operationId)
    );

    try {
      await this.telegramClient.answerCallbackQuery(callbackId, Messages.saveFailedToast);
    } catch (callbackError) {
      Logger.warn(
        `Could not answer callback query after save error: ${getErrorMessage(callbackError)}`
      );
    }
  }
}
