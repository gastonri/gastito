import type { ClarificationQuestion, AIClarificationResponse } from "../types";
import { Buttons } from "./messages";

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

  private static confirmRows(operationId: string): InlineKeyboardButton[][] {
    return [
      [
        { text: Buttons.confirm, callback_data: `conf_${operationId}` },
        { text: Buttons.cancel, callback_data: `cancel_${operationId}` },
      ],
      [{ text: Buttons.edit, callback_data: `edit_${operationId}` }],
    ];
  }

  /**
   * Builds the confirm/cancel keyboard with an extra edit button.
   */
  static buildConfirmCancelKeyboard(operationId: string): InlineKeyboardMarkup {
    return { inline_keyboard: this.confirmRows(operationId) };
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
