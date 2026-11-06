import type { ClarificationQuestion, AIClarificationResponse } from "../types";
import { Buttons, Messages } from "./messages";

export interface InlineKeyboardButton {
  text: string;
  callback_data: string;
}

export interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][];
}

export class ClarificationBuilder {
  /**
   * Builds a message and keyboard for clarification questions.
   */
  static buildClarificationMessage(response: AIClarificationResponse): {
    text: string;
    keyboard: InlineKeyboardMarkup | null;
  } {
    let text = response.message || "Necesito algunos datos adicionales:";
    text += "\n";

    const keyboardRows: InlineKeyboardButton[][] = [];
    let hasSelectQuestions = false;

    for (const question of response.questions) {
      if (question.questionType === "select" && question.options && question.options.length > 0) {
        hasSelectQuestions = true;
        text += `\n${question.questionText}`;

        // Create a row of buttons for this question (max 3 per row)
        const buttons = question.options.slice(0, 8).map((option) => ({
          text: this.truncateText(option, 20),
          callback_data: this.buildCallbackData(question.id, option),
        }));

        // Split buttons into rows of 2-3
        for (let i = 0; i < buttons.length; i += 3) {
          keyboardRows.push(buttons.slice(i, i + 3));
        }
      } else if (question.questionType === "text") {
        text += `\n${question.questionText} (responde con texto)`;
      }
    }

    return {
      text,
      keyboard: hasSelectQuestions ? { inline_keyboard: keyboardRows } : null,
    };
  }

  /**
   * Builds callback data string for a clarification button.
   * Format: clarify_{questionId}_{value}
   * Limited to 64 bytes for Telegram.
   */
  private static buildCallbackData(questionId: string, value: string): string {
    // Telegram callback_data has a 64 byte limit
    // Format: cl_{shortId}_{value}
    const shortId = questionId.slice(0, 8);
    const maxValueLen = 64 - 4 - shortId.length - 1; // 4 for "cl_" + "_"
    const truncatedValue = value.slice(0, maxValueLen);
    return `cl_${shortId}_${truncatedValue}`;
  }

  /**
   * Parses a clarification callback data string.
   */
  static parseCallbackData(data: string): {
    questionIdPrefix: string;
    value: string;
  } | null {
    if (!data.startsWith("cl_")) {
      return null;
    }

    const parts = data.slice(3).split("_");
    if (parts.length < 2) {
      return null;
    }

    const questionIdPrefix = parts[0];
    const value = parts.slice(1).join("_"); // In case value had underscores

    return { questionIdPrefix, value };
  }

  /**
   * Finds a question by its ID prefix (first 8 chars).
   */
  static findQuestionByPrefix(
    questions: ClarificationQuestion[],
    prefix: string
  ): ClarificationQuestion | undefined {
    return questions.find((q) => q.id.startsWith(prefix));
  }

  private static truncateText(text: string, maxLen: number): string {
    if (text.length <= maxLen) return text;
    return text.slice(0, maxLen - 1) + "…";
  }

  /**
   * Builds a combined keyboard with clarification buttons and confirm/cancel.
   */
  static buildCombinedKeyboard(
    clarificationKeyboard: InlineKeyboardMarkup | null,
    operationId: string
  ): InlineKeyboardMarkup {
    const rows = clarificationKeyboard?.inline_keyboard || [];

    // Add confirm/cancel row at the bottom
    rows.push(...this.confirmRows(operationId));

    return { inline_keyboard: rows };
  }

  private static confirmRows(operationId: string, withCategory = false): InlineKeyboardButton[][] {
    const secondRow: InlineKeyboardButton[] = [
      { text: Buttons.edit, callback_data: `edit_${operationId}` },
    ];
    if (withCategory) {
      secondRow.push({ text: Buttons.category, callback_data: `cat_${operationId}` });
    }
    return [
      [
        { text: Buttons.confirm, callback_data: `conf_${operationId}` },
        { text: Buttons.cancel, callback_data: `cancel_${operationId}` },
      ],
      secondRow,
    ];
  }

  // ---- Category picker (callback_data stays well under Telegram's 64 byte limit:
  //      prefix + 36 char UUID + up to three small indices)

  private static pairs(buttons: InlineKeyboardButton[]): InlineKeyboardButton[][] {
    const rows: InlineKeyboardButton[][] = [];
    for (let i = 0; i < buttons.length; i += 2) rows.push(buttons.slice(i, i + 2));
    return rows;
  }

  private static backRow(callbackData: string): InlineKeyboardButton[] {
    return [{ text: Buttons.back, callback_data: callbackData }];
  }

  /** Which movement to recategorize, for operations with several items. */
  static buildItemPicker(operationId: string, descripciones: string[]): InlineKeyboardMarkup {
    const rows = descripciones.map((d, i) => [
      { text: this.truncateText(`${i + 1}. ${d}`, 40), callback_data: `ci_${operationId}_${i}` },
    ]);
    rows.push(this.backRow(`cb_${operationId}`));
    return { inline_keyboard: rows };
  }

  static buildMacroPicker(
    operationId: string,
    itemIdx: number,
    macros: string[],
    backTo: string
  ): InlineKeyboardMarkup {
    const buttons = macros.map((m, i) => ({
      text: this.truncateText(m, 22),
      callback_data: `cm_${operationId}_${itemIdx}_${i}`,
    }));
    return { inline_keyboard: [...this.pairs(buttons), this.backRow(backTo)] };
  }

  static buildSubPicker(
    operationId: string,
    itemIdx: number,
    macroIdx: number,
    subs: string[],
    backTo: string
  ): InlineKeyboardMarkup {
    const buttons = subs.map((s, i) => ({
      text: this.truncateText(s, 22),
      callback_data: `cs_${operationId}_${itemIdx}_${macroIdx}_${i}`,
    }));
    return { inline_keyboard: [...this.pairs(buttons), this.backRow(backTo)] };
  }

  static buildIngresoCategoryPicker(
    operationId: string,
    itemIdx: number,
    categorias: readonly string[],
    backTo: string
  ): InlineKeyboardMarkup {
    const buttons = categorias.map((c, i) => ({
      text: this.truncateText(c, 22),
      callback_data: `cg_${operationId}_${itemIdx}_${i}`,
    }));
    return { inline_keyboard: [...this.pairs(buttons), this.backRow(backTo)] };
  }

  /**
   * Builds the confirm/cancel keyboard with an extra edit button.
   */
  static buildConfirmCancelKeyboard(
    operationId: string,
    dolar?: "TARJETA" | "BLUE" | null
  ): InlineKeyboardMarkup {
    const rows = this.confirmRows(operationId, true);
    if (dolar) {
      rows.push([
        {
          text: dolar === "BLUE" ? Messages.fxToTarjeta : Messages.fxToBlue,
          callback_data: `fx_${operationId}`,
        },
      ]);
    }
    return { inline_keyboard: rows };
  }

  /** Keyboard shown when processing a message failed: re-runs it from the stored original. */
  static buildRetryMessageKeyboard(failedId: string): InlineKeyboardMarkup {
    return { inline_keyboard: [[{ text: Buttons.retry, callback_data: `rm_${failedId}` }]] };
  }

  /**
   * Builds the keyboard shown when saving fails: retry (re-runs confirm) or cancel.
   */
  static buildRetryKeyboard(operationId: string): InlineKeyboardMarkup {
    return {
      inline_keyboard: [
        [
          { text: Buttons.retry, callback_data: `conf_${operationId}` },
          { text: Buttons.cancel, callback_data: `cancel_${operationId}` },
        ],
      ],
    };
  }

  /**
   * Builds a yes/no keyboard to confirm destructive commands (/reset, /exit).
   */
  static buildDangerKeyboard(action: "reset" | "exit" | "undo"): InlineKeyboardMarkup {
    return {
      inline_keyboard: [
        [
          {
            text:
              action === "reset"
                ? Buttons.yesReset
                : action === "undo"
                  ? Buttons.yesUndo
                  : Buttons.yesExit,
            callback_data: `dz_${action}`,
          },
          { text: Buttons.no, callback_data: "dz_no" },
        ],
      ],
    };
  }
}
