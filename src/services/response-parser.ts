import { randomUUID } from "crypto";
import type {
  AIResponse,
  AITransactionResponse,
  AIClarificationResponse,
  AIErrorResponse,
  TransactionResult,
  ClarificationQuestion,
} from "../types";
import { Logger } from "../utils/logger";

export class ResponseParser {
  static parse(rawResponse: string): AIResponse {
    const cleaned = this.cleanResponse(rawResponse);

    try {
      const parsed = JSON.parse(cleaned) as unknown;
      return this.validateAndNormalize(parsed);
    } catch {
      Logger.error("Failed to parse AI response", rawResponse);
      return {
        responseType: "error",
        errorMessage: "No pude procesar la respuesta. Por favor, intenta de nuevo.",
        suggestions: ["Intenta ser más específico con tu mensaje"],
      };
    }
  }

  private static cleanResponse(raw: string): string {
    let cleaned = raw.trim();

    // Remove markdown code blocks
    if (cleaned.startsWith("```json")) {
      cleaned = cleaned.slice(7);
    } else if (cleaned.startsWith("```")) {
      cleaned = cleaned.slice(3);
    }

    if (cleaned.endsWith("```")) {
      cleaned = cleaned.slice(0, -3);
    }

    // Try to extract JSON object if there's surrounding text
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      cleaned = jsonMatch[0];
    }

    return cleaned.trim();
  }

  private static validateAndNormalize(parsed: unknown): AIResponse {
    if (!parsed || typeof parsed !== "object") {
      return this.createErrorResponse("Respuesta inválida del AI");
    }

    const obj = parsed as Record<string, unknown>;

    // Check for responseType field (new format)
    if ("responseType" in obj) {
      return this.normalizeNewFormat(obj);
    }

    // Fallback: try to parse as legacy TransactionResult format
    if ("tipo" in obj && "datos" in obj) {
      return this.normalizeLegacyFormat(obj);
    }

    return this.createErrorResponse("Formato de respuesta no reconocido");
  }

  private static normalizeNewFormat(obj: Record<string, unknown>): AIResponse {
    const responseType = obj.responseType as string;

    switch (responseType) {
      case "transaction":
        return this.normalizeTransactionResponse(obj);
      case "clarification":
        return this.normalizeClarificationResponse(obj);
      case "error":
        return this.normalizeErrorResponse(obj);
      default:
        return this.createErrorResponse(`Tipo de respuesta desconocido: ${responseType}`);
    }
  }

  private static normalizeTransactionResponse(
    obj: Record<string, unknown>
  ): AITransactionResponse {
    const transaction = obj.transaction as TransactionResult;

    // Ensure questions have IDs
    let questions: ClarificationQuestion[] | undefined;
    if (Array.isArray(obj.questions)) {
      questions = this.normalizeQuestions(obj.questions);
    }

    return {
      responseType: "transaction",
      transaction: this.normalizeTransactionResult(transaction),
      questions,
    };
  }

  private static normalizeClarificationResponse(
    obj: Record<string, unknown>
  ): AIClarificationResponse {
    const questions = Array.isArray(obj.questions)
      ? this.normalizeQuestions(obj.questions)
      : [];

    if (questions.length === 0) {
      Logger.warn("Clarification response has no questions, converting to error");
      return {
        responseType: "clarification",
        message: (obj.message as string) || "Necesito más información",
        questions: [
          {
            id: randomUUID(),
            field: "descripcion",
            questionText: "Por favor, proporciona más detalles sobre la transacción",
            questionType: "text",
            confidence: "BAJA",
          },
        ],
      };
    }

    return {
      responseType: "clarification",
      partialTransaction: obj.partialTransaction as Partial<TransactionResult> | undefined,
      questions,
      message: (obj.message as string) || "Necesito algunos datos adicionales",
    };
  }

  private static normalizeErrorResponse(obj: Record<string, unknown>): AIErrorResponse {
    return {
      responseType: "error",
      errorMessage: (obj.errorMessage as string) || "Ocurrió un error inesperado",
      suggestions: Array.isArray(obj.suggestions)
        ? (obj.suggestions as string[])
        : undefined,
    };
  }

  private static normalizeLegacyFormat(obj: Record<string, unknown>): AIResponse {
    // Legacy format: direct TransactionResult
    const transaction = this.normalizeTransactionResult(obj as unknown as TransactionResult);

    // Check if we should convert to clarification based on confidence
    if (transaction.confianza === "BAJA" && transaction.campos_faltantes?.length) {
      return {
        responseType: "clarification",
        partialTransaction: { tipo: transaction.tipo, datos: transaction.datos },
        questions: this.generateQuestionsFromMissingFields(transaction.campos_faltantes),
        message: transaction.razonamiento || "Necesito algunos datos adicionales",
      };
    }

    return {
      responseType: "transaction",
      transaction,
    };
  }

  private static normalizeTransactionResult(raw: TransactionResult): TransactionResult {
    return {
      tipo: raw.tipo || "GASTO",
      datos: raw.datos || {},
      confianza: raw.confianza,
      campos_faltantes: raw.campos_faltantes,
      razonamiento: raw.razonamiento,
      alerta: raw.alerta,
      usa_contexto: raw.usa_contexto,
    };
  }

  private static normalizeQuestions(
    rawQuestions: unknown[]
  ): ClarificationQuestion[] {
    return rawQuestions.map((q) => {
      const question = q as Partial<ClarificationQuestion>;
      return {
        id: question.id || randomUUID(),
        field: question.field || "descripcion",
        questionText: question.questionText || "Por favor, proporciona más información",
        questionType: question.questionType || "text",
        options: question.options,
        currentValue: question.currentValue,
        confidence: question.confidence || "BAJA",
      };
    });
  }

  private static generateQuestionsFromMissingFields(
    fields: string[]
  ): ClarificationQuestion[] {
    const fieldQuestions: Record<string, { text: string; type: "select" | "text" }> = {
      monto: { text: "¿Cuál fue el monto?", type: "text" },
      descripcion: { text: "¿Cuál es la descripción?", type: "text" },
      macro_categoria: { text: "¿En qué categoría?", type: "select" },
      subcategoria: { text: "¿Cuál es la subcategoría?", type: "select" },
      mi_parte: { text: "¿Qué porcentaje del gasto te corresponde? (0-100)", type: "text" },
    };

    return fields.slice(0, 3).map((field) => {
      const config = fieldQuestions[field] || {
        text: `¿Cuál es el valor de ${field}?`,
        type: "text" as const,
      };
      return {
        id: randomUUID(),
        field: field as ClarificationQuestion["field"],
        questionText: config.text,
        questionType: config.type,
        confidence: "BAJA" as const,
      };
    });
  }

  private static createErrorResponse(message: string): AIErrorResponse {
    return {
      responseType: "error",
      errorMessage: message,
    };
  }
}
