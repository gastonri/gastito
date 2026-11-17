import axios, { AxiosResponse } from "axios";
import { config } from "../config";
import { Logger } from "../utils/logger";
import { GeminiAPIError } from "../utils/errors";
import { ImageData, AudioData, GeminiResponse, GeminiErrorDetail } from "../types";
import { AIClient } from "./client";
import { AiSlot, FailureReason, keyLabel, recordFailure, recordSuccess } from "./attempts";

/** The request exceeded the configured timeout (axios: "timeout of 12000ms exceeded"). */
export function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && /timeout of \d+ms exceeded/i.test(error.message);
}

/** Google answered with a server-side error (503 overloaded, 500, 502, 504): another key may work. */
export function isServerError(error: unknown): boolean {
  return (
    error instanceof GeminiAPIError &&
    error.statusCode !== undefined &&
    error.statusCode >= 500 &&
    error.statusCode <= 599
  );
}

/**
 * Picks the next key to try: the first one not already tried in this request and not rate limited.
 * Keys that recently timed out go last, so a hanging key is not retried first on every message,
 * but they are still used when nothing else is left.
 */
export function selectKeyIndex(
  total: number,
  tried: Set<number>,
  rateLimitedUntil: Map<number, number>,
  slowUntil: Map<number, number>,
  now: number
): number | null {
  let slow: number | null = null;
  for (let i = 0; i < total; i++) {
    if (tried.has(i) || now < (rateLimitedUntil.get(i) ?? 0)) continue;
    if (now < (slowUntil.get(i) ?? 0)) {
      slow ??= i;
      continue;
    }
    return i;
  }
  return slow;
}

/** How long a model that answered 404 is skipped. */
const MODEL_UNAVAILABLE_MS = 60 * 60 * 1000;

export class GeminiClient implements AIClient {
  private readonly apiKeys: string[];
  private readonly keyCooldowns: Map<number, number> = new Map();
  private readonly slowKeys: Map<number, number> = new Map();
  private readonly models: string[];
  private readonly thinkingUnsupported: Set<string> = new Set();
  private readonly baseUrl: string;

  constructor() {
    this.apiKeys = config.ai.gemini.apiKeys;
    this.models = config.ai.gemini.modelNames;
    this.baseUrl = "https://generativelanguage.googleapis.com/v1beta";
  }

  /**
   * Posts a generateContent request limiting the model's reasoning (the default level is slow
   * for this bot's extraction task). If the model rejects the setting, retries without it.
   */
  private async post(
    url: string,
    payload: object,
    meta: { op: string; keyIndex: number; model: string }
  ): Promise<AxiosResponse<GeminiResponse>> {
    // Models that already rejected the setting are called without it, saving a wasted request.
    const level = this.thinkingUnsupported.has(meta.model) ? "" : config.ai.gemini.thinkingLevel;
    const started = Date.now();
    const base = {
      op: meta.op,
      model: meta.model,
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
          this.thinkingUnsupported.add(meta.model);
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

  /**
   * A slot is one (model, key) pair. Slots are ordered model first: every key is tried on the
   * preferred model before moving to the next one, because free-tier quotas are per model.
   */
  private slotModel(slot: number): string {
    return this.models[Math.floor(slot / this.apiKeys.length)];
  }

  private slotKeyIndex(slot: number): number {
    return slot % this.apiKeys.length;
  }

  private getAvailableSlot(tried: Set<number> = new Set()): number | null {
    return selectKeyIndex(
      this.models.length * this.apiKeys.length,
      tried,
      this.keyCooldowns,
      this.slowKeys,
      Date.now()
    );
  }

  private async executeWithFallback<T>(
    fn: (apiKey: string, keyIndex: number, model: string) => Promise<T>
  ): Promise<T> {
    // Slots that already timed out or failed on the server for this request: do not retry them.
    const failed = new Set<number>();
    let lastFailure: Error | null = null;
    let timeouts = 0;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const slot = this.getAvailableSlot(failed);
      if (slot === null) {
        if (lastFailure) throw lastFailure;
        throw new GeminiAPIError("All Gemini models and API keys are rate limited", 429);
      }
      const keyIndex = this.slotKeyIndex(slot);
      const model = this.slotModel(slot);
      const key = `${keyIndex + 1}/${this.apiKeys.length}`;
      const current: AiSlot = { model, keyLabel: keyLabel(keyIndex) };
      // Tells the bot (and so the user) that this slot failed and where the call goes next.
      const reportFailure = (reason: FailureReason) => {
        const nextSlot = this.getAvailableSlot(failed);
        recordFailure(
          { ...current, reason },
          nextSlot === null
            ? null
            : { model: this.slotModel(nextSlot), keyLabel: keyLabel(this.slotKeyIndex(nextSlot)) }
        );
      };

      try {
        const value = await fn(this.apiKeys[keyIndex], keyIndex, model);
        recordSuccess(current);
        return value;
      } catch (error) {
        if (error instanceof GeminiAPIError && error.statusCode === 429) {
          const cooldownMs = config.ai.gemini.rateLimitCooldownMs;
          this.keyCooldowns.set(slot, Date.now() + cooldownMs);
          Logger.event("gemini_key_cooldown", { model, key, cooldown_s: cooldownMs / 1000 });
          reportFailure("rate_limit");
          continue;
        }
        if (error instanceof GeminiAPIError && error.statusCode === 404) {
          // The model does not exist (or was retired) for this key: skip it on every key for a while.
          const blockedUntil = Date.now() + MODEL_UNAVAILABLE_MS;
          for (let k = 0; k < this.apiKeys.length; k++) {
            const modelSlot = this.models.indexOf(model) * this.apiKeys.length + k;
            this.keyCooldowns.set(modelSlot, blockedUntil);
            failed.add(modelSlot);
          }
          lastFailure = error;
          Logger.event("gemini_model_unavailable", {
            model,
            next: this.getAvailableSlot(failed) !== null,
          });
          reportFailure("model_unavailable");
          continue;
        }
        if (isTimeoutError(error)) {
          lastFailure = error as Error;
          timeouts++;
          // Hangs hit every key of a model at once, so skip the rest of this model for this
          // request and deprioritize it for the next messages instead of waiting on each key.
          const slowMs = config.ai.gemini.slowKeyCooldownMs;
          const modelIndex = this.models.indexOf(model);
          for (let k = 0; k < this.apiKeys.length; k++) {
            const modelSlot = modelIndex * this.apiKeys.length + k;
            failed.add(modelSlot);
            this.slowKeys.set(modelSlot, Date.now() + slowMs);
          }
          const next = this.getAvailableSlot(failed) !== null;
          Logger.event("gemini_timeout", {
            model,
            key,
            next_key: next,
            deprioritized_s: slowMs / 1000,
          });
          reportFailure("timeout");
          // Bound the wait for the user: each timeout costs a full timeout period.
          if (timeouts >= config.ai.gemini.maxTimeoutsPerRequest) throw lastFailure;
          continue;
        }
        if (isServerError(error)) {
          failed.add(slot);
          lastFailure = error as Error;
          Logger.event("gemini_server_error", {
            model,
            key,
            status: (error as GeminiAPIError).statusCode,
            next_key: this.getAvailableSlot(failed) !== null,
          });
          reportFailure("server_error");
          continue;
        }
        throw error;
      }
    }
  }

  async generateContent(prompt: string): Promise<string> {
    return this.executeWithFallback(async (apiKey, keyIndex, model) => {
      try {
        const url = `${this.baseUrl}/models/${model}:generateContent?key=${apiKey}`;
        const payload = {
          contents: [{ parts: [{ text: prompt }] }],
        };

        const response = await this.post(url, payload, { op: "text", keyIndex, model });
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
    return this.executeWithFallback(async (apiKey, keyIndex, model) => {
      try {
        const url = `${this.baseUrl}/models/${model}:generateContent?key=${apiKey}`;
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

        Logger.log(`Calling Gemini Vision API with model: ${model}`);
        const response = await this.post(url, payload, { op: "vision", keyIndex, model });
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
    return this.executeWithFallback(async (apiKey, keyIndex, model) => {
      try {
        const url = `${this.baseUrl}/models/${model}:generateContent?key=${apiKey}`;
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

        Logger.log(`Calling Gemini Audio API with model: ${model}`);
        const response = await this.post(url, payload, { op: "audio", keyIndex, model });
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
