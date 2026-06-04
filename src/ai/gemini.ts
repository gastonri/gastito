import axios from "axios";
import { config } from "../config";
import { Logger } from "../utils/logger";
import { GeminiAPIError } from "../utils/errors";
import { ImageData, AudioData, GeminiResponse, GeminiErrorDetail } from "../types";
import { AIClient } from "./client";

export class GeminiClient implements AIClient {
  private readonly apiKeys: string[];
  private readonly keyCooldowns: Map<number, number> = new Map();
  private readonly modelName: string;
  private readonly baseUrl: string;

  constructor() {
    this.apiKeys = config.ai.gemini.apiKeys;
    this.modelName = config.ai.gemini.modelName;
    this.baseUrl = "https://generativelanguage.googleapis.com/v1";
  }

  private getAvailableKeyIndex(): number | null {
    const now = Date.now();
    for (let i = 0; i < this.apiKeys.length; i++) {
      if (now >= (this.keyCooldowns.get(i) ?? 0)) {
        return i;
      }
    }
    return null;
  }

  private async executeWithFallback<T>(fn: (apiKey: string) => Promise<T>): Promise<T> {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const keyIndex = this.getAvailableKeyIndex();
      if (keyIndex === null) {
        throw new GeminiAPIError("All Gemini API keys are rate limited", 429);
      }

      try {
        return await fn(this.apiKeys[keyIndex]);
      } catch (error) {
        if (error instanceof GeminiAPIError && error.statusCode === 429) {
          const cooldownMs = config.ai.gemini.rateLimitCooldownMs;
          this.keyCooldowns.set(keyIndex, Date.now() + cooldownMs);
          Logger.log(
            `Gemini key ${keyIndex + 1}/${this.apiKeys.length} rate limited, cooldown ${cooldownMs / 1000}s`
          );
          continue;
        }
        throw error;
      }
    }
  }

  async generateContent(prompt: string): Promise<string> {
    return this.executeWithFallback(async (apiKey) => {
      try {
        const url = `${this.baseUrl}/models/${this.modelName}:generateContent?key=${apiKey}`;
        const payload = {
          contents: [{ parts: [{ text: prompt }] }],
        };

        const response = await axios.post<GeminiResponse>(url, payload);
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const json: GeminiResponse = response.data;

        if (response.status !== 200 || json.error) {
          const errorMsg = json.error ? JSON.stringify(json.error) : "Unknown error";
          throw new GeminiAPIError(`Gemini API Error: ${errorMsg}`, response.status);
        }

        if (!json.candidates || json.candidates.length === 0) {
          throw new GeminiAPIError("Gemini API Error: No candidates in response");
        }

        const text = json.candidates[0]?.content?.parts?.[0]?.text;
        if (!text) {
          throw new GeminiAPIError("Gemini API Error: No text in response");
        }

        return text;
      } catch (error) {
        Logger.error("Error calling Gemini API", error);
        if (axios.isAxiosError(error)) {
          const statusCode = error.response?.status;
          const errorData = error.response?.data as GeminiResponse | undefined;
          const geminiError = errorData?.error;

          if (statusCode === 429 && geminiError) {
            const message = geminiError.message || JSON.stringify(geminiError);
            const details = geminiError.details || [];
            const retryInfo = details.find((d: GeminiErrorDetail) =>
              d["@type"]?.includes("RetryInfo")
            );
            const retryDelay = retryInfo?.retryDelay || null;

            let errorMsg = message;
            if (retryDelay) {
              errorMsg += ` Retry after: ${retryDelay}`;
            }

            throw new GeminiAPIError(errorMsg, statusCode);
          }

          const errorMsg = geminiError ? JSON.stringify(geminiError) : error.message;
          throw new GeminiAPIError(`Gemini API Error: ${errorMsg}`, statusCode);
        }
        throw error;
      }
    });
  }

  async generateContentWithVision(prompt: string, imageData: ImageData): Promise<string> {
    return this.executeWithFallback(async (apiKey) => {
      try {
        const url = `${this.baseUrl}/models/${this.modelName}:generateContent?key=${apiKey}`;
        const payload = {
          contents: [
            {
              parts: [
                { text: prompt },
                {
                  inline_data: {
                    mime_type: imageData.mimeType,
                    data: imageData.data,
                  },
                },
              ],
            },
          ],
        };

        Logger.log(`Calling Gemini Vision API with model: ${this.modelName}`);
        const response = await axios.post<GeminiResponse>(url, payload);
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const json: GeminiResponse = response.data;

        Logger.log(`Gemini Vision response code: ${response.status}`);

        if (response.status !== 200 || json.error) {
          const errorMsg = json.error ? JSON.stringify(json.error) : "Unknown error";
          throw new GeminiAPIError(
            `Gemini Vision Error (${response.status}): ${errorMsg}`,
            response.status
          );
        }

        if (!json.candidates || json.candidates.length === 0) {
          Logger.log("Gemini Vision response without candidates", json);
          throw new GeminiAPIError("Gemini Vision Error: No candidates in response");
        }

        if (!json.candidates[0]?.content?.parts || json.candidates[0].content.parts.length === 0) {
          Logger.log("Gemini Vision unexpected structure", json.candidates[0]);
          throw new GeminiAPIError("Gemini Vision Error: Unexpected response structure");
        }

        const text = json.candidates[0].content.parts[0]?.text;
        if (!text) {
          Logger.log("Gemini Vision response without text", json.candidates[0]);
          throw new GeminiAPIError("Gemini Vision Error: No text in response");
        }

        Logger.log(`Gemini Vision response successful (${text.length} characters)`);
        return text;
      } catch (error) {
        Logger.error("Error calling Gemini Vision API", error);
        if (axios.isAxiosError(error)) {
          const statusCode = error.response?.status;
          const errorData = error.response?.data as GeminiResponse | undefined;
          const geminiError = errorData?.error;

          if (statusCode === 429 && geminiError) {
            const message = geminiError.message || JSON.stringify(geminiError);
            const details = geminiError.details || [];
            const retryInfo = details.find((d: GeminiErrorDetail) =>
              d["@type"]?.includes("RetryInfo")
            );
            const retryDelay = retryInfo?.retryDelay || null;

            let errorMsg = message;
            if (retryDelay) {
              errorMsg += ` Retry after: ${retryDelay}`;
            }

            throw new GeminiAPIError(errorMsg, statusCode);
          }

          const errorMsg = geminiError ? JSON.stringify(geminiError) : error.message;
          throw new GeminiAPIError(`Gemini Vision Error: ${errorMsg}`, statusCode);
        }
        throw error;
      }
    });
  }

  async transcribeAudio(audioData: AudioData): Promise<string> {
    return this.executeWithFallback(async (apiKey) => {
      try {
        const url = `${this.baseUrl}/models/${this.modelName}:generateContent?key=${apiKey}`;
        const prompt = `Transcribí este audio al español. El usuario está describiendo un gasto, ingreso o transferencia financiera.
Transcribí TODO el contenido del audio de forma literal y completa, sin resumir ni interpretar.
Si el audio está en otro idioma, traducilo al español primero y luego transcribilo.

IMPORTANTE:
- El audio está en español (o debe traducirse al español)
- Solo transcribí el texto, no agregues comentarios ni explicaciones adicionales
- Mantené la transcripción exacta de lo que dice el usuario`;

        const payload = {
          contents: [
            {
              parts: [
                { text: prompt },
                {
                  inline_data: {
                    mime_type: audioData.mimeType,
                    data: audioData.data,
                  },
                },
              ],
            },
          ],
        };

        Logger.log(`Calling Gemini Audio API with model: ${this.modelName}`);
        const response = await axios.post<GeminiResponse>(url, payload);
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const json: GeminiResponse = response.data;

        Logger.log(`Gemini Audio response code: ${response.status}`);

        if (response.status !== 200 || json.error) {
          const errorMsg = json.error ? JSON.stringify(json.error) : "Unknown error";
          throw new GeminiAPIError(
            `Gemini Audio Error (${response.status}): ${errorMsg}`,
            response.status
          );
        }

        if (!json.candidates || json.candidates.length === 0) {
          Logger.log("Gemini Audio response without candidates", json);
          throw new GeminiAPIError("Gemini Audio Error: No candidates in response");
        }

        if (!json.candidates[0]?.content?.parts || json.candidates[0].content.parts.length === 0) {
          Logger.log("Gemini Audio unexpected structure", json.candidates[0]);
          throw new GeminiAPIError("Gemini Audio Error: Unexpected response structure");
        }

        const text = json.candidates[0].content.parts[0]?.text;
        if (!text) {
          Logger.log("Gemini Audio response without text", json.candidates[0]);
          throw new GeminiAPIError("Gemini Audio Error: No text in response");
        }

        Logger.log(`Transcription successful (${text.length} characters)`);
        return text.trim();
      } catch (error) {
        Logger.error("Error calling Gemini Audio API", error);
        if (axios.isAxiosError(error)) {
          const statusCode = error.response?.status;
          const errorData = error.response?.data as GeminiResponse | undefined;
          const geminiError = errorData?.error;

          if (statusCode === 429 && geminiError) {
            const message = geminiError.message || JSON.stringify(geminiError);
            const details = geminiError.details || [];
            const retryInfo = details.find((d: GeminiErrorDetail) =>
              d["@type"]?.includes("RetryInfo")
            );
            const retryDelay = retryInfo?.retryDelay || null;

            let errorMsg = message;
            if (retryDelay) {
              errorMsg += ` Retry after: ${retryDelay}`;
            }

            throw new GeminiAPIError(errorMsg, statusCode);
          }

          const errorMsg = geminiError ? JSON.stringify(geminiError) : error.message;
          throw new GeminiAPIError(`Gemini Audio Error: ${errorMsg}`, statusCode);
        }
        throw error;
      }
    });
  }
}
