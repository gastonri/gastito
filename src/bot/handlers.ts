import {
  TelegramMessage,
  TransactionResult,
  AIResponse,
  ConversationMessage,
  ClarificationQuestion,
  ConfigData,
} from "../types";
import { AIClientManager } from "../ai/client";
import { PromptBuilder } from "../ai/prompts";
import { SheetsClient } from "../sheets/client";
import { ImageProcessor } from "../services/image-processor";
import { AudioProcessor } from "../services/audio-processor";
import { contextManager } from "../services/context-manager";
import { pendingOperations } from "../services/pending-operations";
import { Logger } from "../utils/logger";
import { getErrorMessage, extractTextWithoutEmoji } from "../utils/text";
import { config } from "../config";
import { UserPreferencesService } from "../services/user-preferences";
import { mapTransactionIndices } from "../services/validator";
import { ResponseParser } from "../services/response-parser";

export class MessageHandlers {
  constructor(
    private aiClientManager: AIClientManager,
    private userPreferences: UserPreferencesService,
    private sheetsClient: SheetsClient,
    private imageProcessor: ImageProcessor,
    private audioProcessor: AudioProcessor
  ) {}

  async handleTextMessage(message: TelegramMessage): Promise<TransactionResult[]> {
    const text = message.text!;
    const chatId = message.chat.id;

    const contextoPrevio = contextManager.getContext(chatId);
    const operacionPendiente = pendingOperations.getLastPendingOperation(chatId);
    const sheetsConfig = await this.sheetsClient.getConfig();

    const prompt = PromptBuilder.buildTextPrompt(
      text,
      sheetsConfig.categoriasMap,
      contextoPrevio,
      operacionPendiente
    );

    const userProvider = await this.userPreferences.getAIProvider(chatId);
    const aiClient = this.aiClientManager.getClient(userProvider);
    const response = await aiClient.generateContent(prompt);

    const results = this.parseAIResponse(response);

    return results.map((result) => {
      if (result.usa_contexto === undefined) {
        result.usa_contexto = contextoPrevio !== null;
      }
      result = this.applyGastoDefaults(result, text, sheetsConfig);
      const mapped = mapTransactionIndices(result, sheetsConfig);
      mapped.datos.persona = this.resolvePersona(message);
      return mapped;
    });
  }

  async handleImageMessage(message: TelegramMessage): Promise<TransactionResult[]> {
    const photo = message.photo![message.photo!.length - 1];
    const caption = message.caption || "";

    const imageData = await this.imageProcessor.downloadImage(photo.file_id);
    const sheetsConfig = await this.sheetsClient.getConfig();

    const prompt = PromptBuilder.buildVisionPrompt(caption, sheetsConfig.categoriasMap);

    const userProvider = await this.userPreferences.getAIProvider(message.chat.id);
    const aiClient = this.aiClientManager.getClient(userProvider);

    Logger.log(`Calling ${userProvider === "gemini" ? "Gemini" : "Anthropic"} Vision...`);
    let response: string;
    try {
      response = await aiClient.generateContentWithVision(prompt, imageData);
      Logger.log(
        `Response received from ${userProvider === "gemini" ? "Gemini" : "Anthropic"} (${response.length} characters)`
      );
    } catch (visionError) {
      Logger.error("Error in Gemini Vision", visionError);
      throw new Error(`Error al analizar imagen con IA: ${getErrorMessage(visionError)}`);
    }

    const results = this.parseAIResponse(response);

    return results.map((result) => {
      if (result.confianza === "BAJA" || (result.campos_faltantes && result.campos_faltantes.length > 0)) {
        result.alerta = `⚠️ Confianza ${result.confianza}. Campos dudosos: ${result.campos_faltantes?.join(", ") || ""}`;
      }
      if (result.razonamiento) {
        result.alerta = (result.alerta || "") + `\n\n💡 ${result.razonamiento}`;
      }
      const mapped = mapTransactionIndices(result, sheetsConfig);
      mapped.datos.persona = this.resolvePersona(message);
      return mapped;
    });
  }

  async handleAudioMessage(message: TelegramMessage): Promise<TransactionResult[]> {
    const chatId = message.chat.id;
    const audioFile = message.voice || message.audio!;

    const maxFileSize = 20 * 1024 * 1024;
    if (audioFile.file_size && audioFile.file_size > maxFileSize) {
      throw new Error(
        `El archivo de audio es demasiado grande (${Math.round(audioFile.file_size / 1024 / 1024)}MB). Máximo permitido: 20MB`
      );
    }

    const audioData = await this.audioProcessor.downloadAudio(audioFile.file_id);

    const userProvider = await this.userPreferences.getAIProvider(chatId);
    const aiClient = this.aiClientManager.getClient(userProvider);

    const textoTranscrito = await aiClient.transcribeAudio(audioData);
    Logger.log(`Transcribed text: ${textoTranscrito}`);

    if (!textoTranscrito || textoTranscrito.trim() === "") {
      throw new Error(
        "No se pudo transcribir el audio. Asegurate de que el audio sea claro y esté en español."
      );
    }

    const contextoPrevio = contextManager.getContext(chatId);
    const operacionPendiente = pendingOperations.getLastPendingOperation(chatId);
    const sheetsConfig = await this.sheetsClient.getConfig();

    const prompt = PromptBuilder.buildTextPrompt(
      textoTranscrito,
      sheetsConfig.categoriasMap,
      contextoPrevio,
      operacionPendiente
    );

    const response = await aiClient.generateContent(prompt);
    const results = this.parseAIResponse(response);

    return results.map((result) => {
      if (result.usa_contexto === undefined) {
        result.usa_contexto = contextoPrevio !== null;
      }
      result = this.applyGastoDefaults(result, textoTranscrito, sheetsConfig);
      const mapped = mapTransactionIndices(result, sheetsConfig);
      mapped.datos.persona = this.resolvePersona(message);
      return mapped;
    });
  }

  async handleConversationalMessage(
    text: string,
    chatId: number,
    conversationHistory: ConversationMessage[],
    pendingQuestions?: ClarificationQuestion[],
    partialTransaction?: Partial<TransactionResult>
  ): Promise<AIResponse> {
    const sheetsConfig = await this.sheetsClient.getConfig();

    const prompt = PromptBuilder.buildConversationalPrompt(
      conversationHistory,
      text,
      sheetsConfig.categoriasMap,
      pendingQuestions,
      partialTransaction
    );

    const userProvider = await this.userPreferences.getAIProvider(chatId);
    const aiClient = this.aiClientManager.getClient(userProvider);

    const response = await aiClient.generateContent(prompt);
    Logger.log(`Conversational AI response (${response.length} chars)`);

    const parsed = ResponseParser.parse(response);

    if (parsed.responseType === "transaction") {
      parsed.transaction = mapTransactionIndices(parsed.transaction, sheetsConfig);
    }

    if (parsed.responseType === "clarification" && parsed.questions) {
      parsed.questions = this.enrichQuestionOptions(parsed.questions, sheetsConfig);
    }

    return parsed;
  }

  private parseAIResponse(response: string): TransactionResult[] {
    let cleaned = response.replace(/```json|```/g, "").trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) cleaned = jsonMatch[0];

    Logger.log(`Cleaned response for parsing (${cleaned.length} chars): ${cleaned.substring(0, 200)}...`);

    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch (parseError) {
      Logger.error("Error parsing JSON", parseError);
      Logger.error(`Full response: ${response}`);

      const extractedJson = response.match(/\{[\s\S]{20,}\}/);
      if (extractedJson) {
        try {
          parsed = JSON.parse(extractedJson[0]);
          Logger.log("Successfully extracted JSON from response");
        } catch { /* fall through */ }
      }

      if (!parsed) {
        throw new Error(
          `Error al procesar respuesta de IA. La respuesta no es JSON válido: ${getErrorMessage(parseError)}\n\nRespuesta recibida: ${cleaned.substring(0, 500)}`
        );
      }
    }

    const obj = parsed as Record<string, unknown>;

    // New format: { gastos: [...] }
    if (Array.isArray(obj.gastos) && obj.gastos.length > 0) {
      Logger.log(`Parsed ${obj.gastos.length} gasto(s) from response`);
      return obj.gastos as TransactionResult[];
    }

    // Fallback: old format { tipo, datos }
    if (obj.tipo && obj.datos) {
      Logger.log("Parsed response in legacy single-gasto format");
      return [parsed as TransactionResult];
    }

    throw new Error(`Formato de respuesta inesperado: ${cleaned.substring(0, 200)}`);
  }

  private applyGastoDefaults(
    result: TransactionResult,
    text: string,
    sheetsConfig: ConfigData
  ): TransactionResult {
    if (result.tipo !== "GASTO") return result;

    if (!result.datos.monto || result.datos.monto === 0) {
      const numberMatch = text.match(/(\d+(?:[.,]\d+)?)/);
      if (numberMatch) {
        result.datos.monto = parseFloat(numberMatch[1].replace(",", "."));
      }
    }

    if (!result.datos.descripcion || result.datos.descripcion.trim() === "") {
      result.datos.descripcion = "Pendiente de confirmación";
    }

    const subcategoriaEmpty =
      !result.datos.subcategoria ||
      (typeof result.datos.subcategoria === "string" && result.datos.subcategoria.trim() === "");
    const macroCategoriaPresent =
      result.datos.macro_categoria &&
      (typeof result.datos.macro_categoria === "number" ||
        (typeof result.datos.macro_categoria === "string" &&
          result.datos.macro_categoria.trim() !== ""));

    if (subcategoriaEmpty && macroCategoriaPresent && typeof result.datos.macro_categoria === "string") {
      const inferred = this.tryInferSubcategory(
        text,
        result.datos.macro_categoria,
        sheetsConfig.categoriasMap
      );
      if (inferred) {
        Logger.log(`Inferred subcategory "${inferred}" for macro "${result.datos.macro_categoria}"`);
        result.datos.subcategoria = inferred;
      }
    }

    if (!result.datos.moneda) result.datos.moneda = "ARS";
    if (!result.datos.cuotas) result.datos.cuotas = 1;
    if (!result.datos.n_cuota) result.datos.n_cuota = 1;
    if (result.datos.mi_parte === undefined) result.datos.mi_parte = 100;

    return result;
  }

  private resolvePersona(message: TelegramMessage): string {
    return (
      config.telegram.userNames[String(message.chat.id)] ||
      message.from?.first_name ||
      "Usuario"
    );
  }

  private enrichQuestionOptions(
    questions: ClarificationQuestion[],
    sheetsConfig: { categoriasMap: import("../types").CategoryMap }
  ): ClarificationQuestion[] {
    return questions.map((q) => {
      if (q.questionType === "select" && (!q.options || q.options.length === 0)) {
        switch (q.field) {
          case "macro_categoria":
            q.options = Object.keys(sheetsConfig.categoriasMap);
            break;
          case "subcategoria":
            q.options = Object.values(sheetsConfig.categoriasMap).flat();
            break;
          case "moneda":
            q.options = ["ARS", "USD"];
            break;
        }
      }
      return q;
    });
  }

  private tryInferSubcategory(
    text: string,
    macroCategoria: string,
    categoriasMap: import("../types").CategoryMap
  ): string | null {
    const subcategorias = categoriasMap[macroCategoria];
    if (!subcategorias || subcategorias.length === 0) return null;

    const textLower = text.toLowerCase();

    for (const subcat of subcategorias) {
      const subcatClean = extractTextWithoutEmoji(subcat).toLowerCase();
      if (textLower.includes(subcatClean) || subcatClean.includes(textLower)) {
        return extractTextWithoutEmoji(subcat);
      }
    }

    const textWords = textLower.split(/\s+/);
    for (const subcat of subcategorias) {
      const subcatClean = extractTextWithoutEmoji(subcat).toLowerCase();
      const subcatWords = subcatClean.split(/[\s/]+/);

      for (const textWord of textWords) {
        if (textWord.length < 3) continue;
        for (const subcatWord of subcatWords) {
          if (subcatWord.length < 3) continue;
          if (textWord.includes(subcatWord) || subcatWord.includes(textWord)) {
            return extractTextWithoutEmoji(subcat);
          }
        }
      }
    }

    if (subcategorias.length > 0) {
      Logger.log(
        `No match found for text "${text}" in macro "${macroCategoria}", using first subcategory as fallback`
      );
      return extractTextWithoutEmoji(subcategorias[0]);
    }

    return null;
  }
}
