import {
  TelegramMessage,
  TransactionResult,
  AIResponse,
  ConversationMessage,
  ClarificationQuestion,
} from "../types";
import { AIClientManager } from "../ai/client";
import { PromptBuilder } from "../ai/prompts";
import { SheetsClient } from "../sheets/client";
import { ImageProcessor } from "../services/image-processor";
import { AudioProcessor } from "../services/audio-processor";
import { contextManager } from "../services/context-manager";
import { pendingOperations } from "../services/pending-operations";
import { Logger } from "../utils/logger";
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

  async handleTextMessage(message: TelegramMessage): Promise<TransactionResult> {
    const text = message.text!;
    const chatId = message.chat.id;

    // Get previous context (confirmed transactions)
    const contextoPrevio = contextManager.getContext(chatId);

    // Get last pending operation (unconfirmed, can be modified)
    const operacionPendiente = pendingOperations.getLastPendingOperation(chatId);

    // Get config
    const config = await this.sheetsClient.getConfig();

    // Build prompt (pass both confirmed context and pending operation)
    const prompt = PromptBuilder.buildTextPrompt(
      text,
      config.categoriasMap,
      contextoPrevio,
      operacionPendiente
    );

    // Get user's preferred AI provider and get the client
    const userProvider = await this.userPreferences.getAIProvider(chatId);
    const aiClient = this.aiClientManager.getClient(userProvider);

    // Call AI
    const response = await aiClient.generateContent(prompt);

    // Clean response: remove markdown code blocks and trim
    let cleanedResponse = response.replace(/```json|```/g, "").trim();

    // Try to extract JSON if there's text before/after it
    const jsonMatch = cleanedResponse.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      cleanedResponse = jsonMatch[0];
    }

    Logger.log(
      `Cleaned response for parsing (${cleanedResponse.length} chars): ${cleanedResponse.substring(0, 200)}...`
    );

    let result: TransactionResult;
    try {
      result = JSON.parse(cleanedResponse) as TransactionResult;
    } catch (parseError) {
      Logger.error("Error parsing JSON", parseError);
      Logger.error(`Full response: ${response}`);

      // Try to extract JSON more aggressively
      const jsonPattern = /\{[\s\S]{20,}\}/;
      const extractedJson = response.match(jsonPattern);

      if (extractedJson) {
        try {
          result = JSON.parse(extractedJson[0]) as TransactionResult;
          Logger.log("Successfully extracted JSON from response");
        } catch {
          throw new Error(
            `Error al procesar respuesta de IA. La respuesta no es JSON válido: ${parseError instanceof Error ? parseError.message : String(parseError)}\n\nRespuesta recibida: ${cleanedResponse.substring(0, 500)}`
          );
        }
      } else {
        throw new Error(
          `Error al procesar respuesta de IA. La respuesta no es JSON válido: ${parseError instanceof Error ? parseError.message : String(parseError)}\n\nRespuesta recibida: ${cleanedResponse.substring(0, 500)}`
        );
      }
    }

    // Ensure usa_contexto exists
    if (result.usa_contexto === undefined) {
      result.usa_contexto = contextoPrevio !== null;
    }

    // Validate that we have minimum required data for GASTO
    // If the message seems incomplete, use defaults
    if (result.tipo === "GASTO") {
      // If critical fields are missing, try to infer or use defaults
      if (!result.datos.monto || result.datos.monto === 0) {
        // Try to extract number from original text if possible
        const numberMatch = text.match(/(\d+(?:[.,]\d+)?)/);
        if (numberMatch) {
          result.datos.monto = parseFloat(numberMatch[1].replace(",", "."));
        }
      }

      // If description is empty, use a placeholder
      if (!result.datos.descripcion || result.datos.descripcion.trim() === "") {
        result.datos.descripcion = "Pendiente de confirmación";
      }

      // Try to infer subcategory if missing but macro category exists
      // Note: subcategoria and macro_categoria can be numbers (indices) or strings
      const subcategoriaEmpty =
        !result.datos.subcategoria ||
        (typeof result.datos.subcategoria === "string" && result.datos.subcategoria.trim() === "");
      const macroCategoriaPresent =
        result.datos.macro_categoria &&
        (typeof result.datos.macro_categoria === "number" ||
          (typeof result.datos.macro_categoria === "string" &&
            result.datos.macro_categoria.trim() !== ""));

      if (subcategoriaEmpty && macroCategoriaPresent) {
        // Only try to infer if macro_categoria is a string (not a numeric index)
        if (typeof result.datos.macro_categoria === "string") {
          const inferredSubcategory = this.tryInferSubcategory(
            text,
            result.datos.macro_categoria,
            config.categoriasMap
          );
          if (inferredSubcategory) {
            Logger.log(
              `Inferred subcategory "${inferredSubcategory}" for macro "${result.datos.macro_categoria}" from text: "${text}"`
            );
            result.datos.subcategoria = inferredSubcategory;
          }
        }
      }

      // Default values for missing fields
      if (!result.datos.moneda) result.datos.moneda = "ARS";
      if (!result.datos.cuotas) result.datos.cuotas = 1;
      if (!result.datos.n_cuota) result.datos.n_cuota = 1;
      if (result.datos.mi_parte === undefined) result.datos.mi_parte = 100;
    }

    // Map numbered AI response fields to actual string values
    const mappedResult = mapTransactionIndices(result, config);
    mappedResult.datos.persona = config.telegram.userNames[String(message.chat.id)] || message.from?.first_name || "Usuario";

    return mappedResult;
  }

  async handleImageMessage(message: TelegramMessage): Promise<TransactionResult> {
    const photo = message.photo![message.photo!.length - 1];
    const caption = message.caption || "";

    // Download image
    const imageData = await this.imageProcessor.downloadImage(photo.file_id);

    // Get config
    const config = await this.sheetsClient.getConfig();

    // Build prompt
    const prompt = PromptBuilder.buildVisionPrompt(
      caption,
      config.categoriasMap
    );

    // Get user's preferred AI provider and get the client
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
      throw new Error(
        `Error al analizar imagen con IA: ${visionError instanceof Error ? visionError.message : String(visionError)}`
      );
    }

    // Parse response
    const cleanedResponse = response.replace(/```json|```/g, "").trim();
    Logger.log(
      `Cleaned response for parsing (${cleanedResponse.length} chars): ${cleanedResponse.substring(0, 200)}...`
    );

    let result: TransactionResult;
    try {
      result = JSON.parse(cleanedResponse) as TransactionResult;
    } catch (parseError) {
      Logger.error("Error parsing JSON", parseError);
      throw new Error(
        `Error al procesar respuesta de IA. La respuesta no es JSON válido: ${parseError instanceof Error ? parseError.message : String(parseError)}\n\nRespuesta recibida: ${cleanedResponse.substring(0, 500)}`
      );
    }

    // Add alerts if needed
    if (
      result.confianza === "BAJA" ||
      (result.campos_faltantes && result.campos_faltantes.length > 0)
    ) {
      result.alerta = `⚠️ Confianza ${result.confianza}. Campos dudosos: ${result.campos_faltantes?.join(", ") || ""}`;
    }
    if (result.razonamiento) {
      result.alerta = (result.alerta || "") + `\n\n💡 ${result.razonamiento}`;
    }

    // Map numbered AI response fields to actual string values
    const mappedResult = mapTransactionIndices(result, config);
    mappedResult.datos.persona = config.telegram.userNames[String(message.chat.id)] || message.from?.first_name || "Usuario";

    return mappedResult;
  }

  async handleAudioMessage(message: TelegramMessage): Promise<TransactionResult> {
    const chatId = message.chat.id;
    const audioFile = message.voice || message.audio!;

    // Validate file size (max 20MB)
    const maxFileSize = 20 * 1024 * 1024; // 20MB in bytes
    if (audioFile.file_size && audioFile.file_size > maxFileSize) {
      throw new Error(
        `El archivo de audio es demasiado grande (${Math.round(audioFile.file_size / 1024 / 1024)}MB). Máximo permitido: 20MB`
      );
    }

    // Download audio
    const audioData = await this.audioProcessor.downloadAudio(audioFile.file_id);

    // Get user's preferred AI provider and get the client
    const userProvider = await this.userPreferences.getAIProvider(chatId);
    const aiClient = this.aiClientManager.getClient(userProvider);

    // Transcribe with AI
    const textoTranscrito = await aiClient.transcribeAudio(audioData);
    Logger.log(`Transcribed text: ${textoTranscrito}`);

    if (!textoTranscrito || textoTranscrito.trim() === "") {
      throw new Error(
        "No se pudo transcribir el audio. Asegurate de que el audio sea claro y esté en español."
      );
    }

    // Process transcribed text as if it were a text message
    const contextoPrevio = contextManager.getContext(chatId);
    const operacionPendiente = pendingOperations.getLastPendingOperation(chatId);
    const config = await this.sheetsClient.getConfig();

    const prompt = PromptBuilder.buildTextPrompt(
      textoTranscrito,
      config.categoriasMap,
      contextoPrevio,
      operacionPendiente
    );

    // Reuse the same AI client that was used for transcription
    const response = await aiClient.generateContent(prompt);
    const cleanedResponse = response.replace(/```json|```/g, "").trim();

    let result: TransactionResult;
    try {
      result = JSON.parse(cleanedResponse) as TransactionResult;
    } catch (parseError) {
      Logger.error("Error parsing JSON", parseError);
      throw new Error(
        `Error al procesar respuesta de IA. La respuesta no es JSON válido: ${parseError instanceof Error ? parseError.message : String(parseError)}`
      );
    }

    // Ensure usa_contexto exists
    if (result.usa_contexto === undefined) {
      result.usa_contexto = contextoPrevio !== null;
    }

    // Apply same fallback logic for GASTO as in handleTextMessage
    if (result.tipo === "GASTO") {
      // Note: subcategoria and macro_categoria can be numbers (indices) or strings
      const subcategoriaEmpty =
        !result.datos.subcategoria ||
        (typeof result.datos.subcategoria === "string" && result.datos.subcategoria.trim() === "");
      const macroCategoriaPresent =
        result.datos.macro_categoria &&
        (typeof result.datos.macro_categoria === "number" ||
          (typeof result.datos.macro_categoria === "string" &&
            result.datos.macro_categoria.trim() !== ""));

      if (subcategoriaEmpty && macroCategoriaPresent) {
        // Only try to infer if macro_categoria is a string (not a numeric index)
        if (typeof result.datos.macro_categoria === "string") {
          const inferredSubcategory = this.tryInferSubcategory(
            textoTranscrito,
            result.datos.macro_categoria,
            config.categoriasMap
          );
          if (inferredSubcategory) {
            Logger.log(
              `Inferred subcategory "${inferredSubcategory}" for macro "${result.datos.macro_categoria}" from transcribed text: "${textoTranscrito}"`
            );
            result.datos.subcategoria = inferredSubcategory;
          }
        }
      }
    }

    // Map numbered AI response fields to actual string values
    const mappedResult = mapTransactionIndices(result, config);
    mappedResult.datos.persona = config.telegram.userNames[String(message.chat.id)] || message.from?.first_name || "Usuario";

    return mappedResult;
  }

  /**
   * Handles a message using the conversational flow with session context.
   * Returns an AIResponse that can be a transaction, clarification, or error.
   */
  async handleConversationalMessage(
    text: string,
    chatId: number,
    conversationHistory: ConversationMessage[],
    pendingQuestions?: ClarificationQuestion[],
    partialTransaction?: Partial<TransactionResult>
  ): Promise<AIResponse> {
    // Get config
    const config = await this.sheetsClient.getConfig();

    // Build conversational prompt
    const prompt = PromptBuilder.buildConversationalPrompt(
      conversationHistory,
      text,
      config.categoriasMap,
      pendingQuestions,
      partialTransaction
    );

    // Get user's preferred AI provider
    const userProvider = await this.userPreferences.getAIProvider(chatId);
    const aiClient = this.aiClientManager.getClient(userProvider);

    // Call AI
    const response = await aiClient.generateContent(prompt);
    Logger.log(`Conversational AI response (${response.length} chars)`);

    // Parse response using the new response parser
    const parsed = ResponseParser.parse(response);

    // If it's a transaction response, map indices to actual values
    if (parsed.responseType === "transaction") {
      parsed.transaction = mapTransactionIndices(parsed.transaction, config);
    }

    // If it's a clarification, inject the actual account/category names into options
    if (parsed.responseType === "clarification" && parsed.questions) {
      parsed.questions = this.enrichQuestionOptions(parsed.questions, config);
    }

    return parsed;
  }

  /**
   * Enriches clarification question options with actual config values
   */
  private enrichQuestionOptions(
    questions: ClarificationQuestion[],
    config: { categoriasMap: import("../types").CategoryMap }
  ): ClarificationQuestion[] {
    return questions.map((q) => {
      if (q.questionType === "select" && (!q.options || q.options.length === 0)) {
        switch (q.field) {
          case "macro_categoria":
            q.options = Object.keys(config.categoriasMap);
            break;
          case "subcategoria":
            q.options = Object.values(config.categoriasMap).flat();
            break;
          case "moneda":
            q.options = ["ARS", "USD"];
            break;
        }
      }
      return q;
    });
  }

  /**
   * Tries to infer a subcategory from the user text when subcategory is missing
   * but macro category is present. Uses fuzzy matching to find the best match.
   */
  private tryInferSubcategory(
    text: string,
    macroCategoria: string,
    categoriasMap: import("../types").CategoryMap
  ): string | null {
    const subcategorias = categoriasMap[macroCategoria];
    if (!subcategorias || subcategorias.length === 0) {
      return null;
    }

    const textLower = text.toLowerCase();

    // Helper to extract text without emoji
    const extractTextWithoutEmoji = (text: string): string => {
      if (!text) return "";
      return text
        .replace(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu, "")
        .trim();
    };

    // Try exact match first (case insensitive, without emoji)
    for (const subcat of subcategorias) {
      const subcatClean = extractTextWithoutEmoji(subcat).toLowerCase();
      if (textLower.includes(subcatClean) || subcatClean.includes(textLower)) {
        return extractTextWithoutEmoji(subcat);
      }
    }

    // Try partial match - check if any word in text matches any word in subcategory
    const textWords = textLower.split(/\s+/);
    for (const subcat of subcategorias) {
      const subcatClean = extractTextWithoutEmoji(subcat).toLowerCase();
      const subcatWords = subcatClean.split(/[\s/]+/);

      for (const textWord of textWords) {
        if (textWord.length < 3) continue; // Skip very short words
        for (const subcatWord of subcatWords) {
          if (subcatWord.length < 3) continue;
          if (textWord.includes(subcatWord) || subcatWord.includes(textWord)) {
            return extractTextWithoutEmoji(subcat);
          }
        }
      }
    }

    // If no match found, return the first subcategory as fallback
    if (subcategorias.length > 0) {
      Logger.log(
        `No match found for text "${text}" in macro "${macroCategoria}", using first subcategory as fallback`
      );
      return extractTextWithoutEmoji(subcategorias[0]);
    }

    return null;
  }
}
