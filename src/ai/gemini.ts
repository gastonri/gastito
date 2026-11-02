import axios, { AxiosResponse } from "axios";
import { config } from "../config";
import { Logger } from "../utils/logger";
import { GeminiAPIError } from "../utils/errors";
import { ImageData, AudioData, GeminiResponse, GeminiErrorDetail } from "../types";
import { AIClient } from "./client";

/** The request exceeded the configured timeout (axios: "timeout of 12000ms exceeded"). */
export function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && /timeout of \d+ms exceeded/i.test(error.message);
}

export class GeminiClient implements AIClient {
  private readonly apiKeys: string[];
  private readonly keyCooldowns: Map<number, number> = new Map();
  private readonly modelName: string;
  private readonly baseUrl: string;

  constructor() {
    this.apiKeys = config.ai.gemini.apiKeys;
    this.modelName = config.ai.gemini.modelName;
    this.baseUrl = "https://generativelanguage.googleapis.com/v1beta";
  }

  /**
   * Posts a generateContent request limiting the model's reasoning (the default level is slow
   * for this bot's extraction task). If the model rejects the setting, retries without it.
   */
  private async post(
    url: string,
    payload: object,
    meta: { op: string; keyIndex: number }
  ): Promise<AxiosResponse<GeminiResponse>> {
    const level = config.ai.gemini.thinkingLevel;
    const started = Date.now();
    const base = {
      op: meta.op,
      model: this.modelName,
      key: `${meta.keyIndex + 1}/${this.apiKeys.length}`,
      thinking: level || "default",
    };
    const timeout =
      meta.op === "text" ? config.ai.gemini.timeoutMs : config.ai.gemini.heavyTimeoutMs;
    const send = (body: object) => axios.post<GeminiResponse>(url, body, { timeout });

    try {
      let response: AxiosResponse<GeminiResponse>;
      if (!level) {
        response = await send(payload);
      } else {
        try {
          response = await send({
            ...payload,
            generationConfig: { thinkingConfig: { thinkingLevel: level } },
          });
        } catch (error) {
          if (!(axios.isAxiosError(error) && error.response?.status === 400)) throw error;
          Logger.event("gemini_thinking_rejected", { ...base, level });
          response = await send(payload);
        }
      }
      const usage = response.data.usageMetadata;
      Logger.event("gemini_call", {
        ...base,
        status: response.status,
        ms: Date.now() - started,
        prompt_tokens: usage?.promptTokenCount,
        thought_tokens: usage?.thoughtsTokenCount,
        output_tokens: usage?.candidatesTokenCount,
      });
      return response;
    } catch (error) {
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      const code = axios.isAxiosError(error) ? error.code : undefined;
      Logger.event("gemini_call_failed", {
        ...base,
        status,
        code,
        ms: Date.now() - started,
      });
      throw error;
    }
  }

  private getAvailableKeyIndex(exclude: Set<number> = new Set()): number | null {
    const now = Date.now();
    for (let i = 0; i < this.apiKeys.length; i++) {
      if (!exclude.has(i) && now >= (this.keyCooldowns.get(i) ?? 0)) {
        return i;
      }
    }
    return null;
  }

  private async executeWithFallback<T>(
    fn: (apiKey: string, keyIndex: number) => Promise<T>
  ): Promise<T> {
    // Keys that already timed out for this request: do not wait on them twice.
    const timedOut = new Set<number>();
    let lastTimeout: Error | null = null;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const keyIndex = this.getAvailableKeyIndex(timedOut);
      if (keyIndex === null) {
        if (lastTimeout) throw lastTimeout;
        throw new GeminiAPIError("All Gemini API keys are rate limited", 429);
      }

      try {
        return await fn(this.apiKeys[keyIndex], keyIndex);
      } catch (error) {
        if (error instanceof GeminiAPIError && error.statusCode === 429) {
          const cooldownMs = config.ai.gemini.rateLimitCooldownMs;
          this.keyCooldowns.set(keyIndex, Date.now() + cooldownMs);
          Logger.event("gemini_key_cooldown", {
            key: `${keyIndex + 1}/${this.apiKeys.length}`,
            cooldown_s: cooldownMs / 1000,
          });
          continue;
        }
        if (isTimeoutError(error)) {
          timedOut.add(keyIndex);
          lastTimeout = error as Error;
          Logger.event("gemini_timeout", {
            key: `${keyIndex + 1}/${this.apiKeys.length}`,
            next_key: this.getAvailableKeyIndex(timedOut) !== null,
          });
          continue;
        }
        throw error;
      }
    }
  }

  async generateContent(prompt: string): Promise<string> {
    return this.executeWithFallback(async (apiKey, keyIndex) => {
      try {
        const url = `${this.baseUrl}/models/${this.modelName}:generateContent?key=${apiKey}`;
        const payload = {
          contents: [{ parts: [{ text: prompt }] }],
        };

        const response = await this.post(url, payload, { op: "text", keyIndex });
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
    return this.executeWithFallback(async (apiKey, keyIndex) => {
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
        const response = await this.post(url, payload, { op: "vision", keyIndex });
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
    return this.executeWithFallback(async (apiKey, keyIndex) => {
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
        const response = await this.post(url, payload, { op: "audio", keyIndex });
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
