import axios from "axios";
import { config } from "../config";
import { Logger } from "../utils/logger";
import { TelegramAPIError } from "../utils/errors";
import { TelegramAPIResponse, TelegramMessageResponse, TelegramFileResponse } from "../types";

export class TelegramClient {
  private readonly baseUrl: string;
  private readonly token: string;

  constructor() {
    this.token = config.telegram.token;
    this.baseUrl = `https://api.telegram.org/bot${this.token}`;
  }

  async sendMessage(
    chatId: number,
    text: string,
    keyboard?: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> }
  ): Promise<number | null> {
    try {
      const payload: {
        chat_id: string;
        text: string;
        parse_mode: string;
        reply_markup?: string;
      } = {
        chat_id: chatId.toString(),
        text,
        parse_mode: "Markdown",
      };

      if (keyboard) {
        payload.reply_markup = JSON.stringify(keyboard);
      }

      const response = await axios.post<TelegramAPIResponse<TelegramMessageResponse>>(
        `${this.baseUrl}/sendMessage`,
        payload
      );
      return response.data.result?.message_id || null;
    } catch (error) {
      Logger.error("Error sending Telegram message", error);
      if (axios.isAxiosError(error)) {
        throw new TelegramAPIError(
          `Failed to send message: ${error.message}`,
          error.response?.status
        );
      }
      throw error;
    }
  }

  async editMessage(
    chatId: number,
    messageId: number,
    text: string,
    keyboard?: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> }
  ): Promise<void> {
    try {
      const payload: {
        chat_id: string;
        message_id: number;
        text: string;
        parse_mode: string;
        reply_markup?: string;
      } = {
        chat_id: chatId.toString(),
        message_id: messageId,
        text,
        parse_mode: "Markdown",
      };

      if (keyboard) {
        payload.reply_markup = JSON.stringify(keyboard);
      }

      await axios.post(`${this.baseUrl}/editMessageText`, payload);
    } catch (error) {
      Logger.error("Error editing Telegram message", error);
      if (axios.isAxiosError(error)) {
        throw new TelegramAPIError(
          `Failed to edit message: ${error.message}`,
          error.response?.status
        );
      }
      throw error;
    }
  }

  sendChatAction(chatId: number, action: string): void {
    axios
      .post(`${this.baseUrl}/sendChatAction`, { chat_id: chatId.toString(), action })
      .catch(() => {});
  }

  async answerCallbackQuery(callbackId: string, text: string): Promise<void> {
    try {
      await axios.post(`${this.baseUrl}/answerCallbackQuery`, {
        callback_query_id: callbackId,
        text,
      });
    } catch (error) {
      Logger.error("Error answering callback query", error);
      if (axios.isAxiosError(error)) {
        throw new TelegramAPIError(
          `Failed to answer callback: ${error.message}`,
          error.response?.status
        );
      }
      throw error;
    }
  }

  async getFile(fileId: string): Promise<{ file_path: string }> {
    try {
      const response = await axios.get<TelegramAPIResponse<TelegramFileResponse>>(
        `${this.baseUrl}/getFile`,
        {
          params: { file_id: fileId },
        }
      );
      if (!response.data.result) {
        throw new TelegramAPIError("No file result in response");
      }
      return response.data.result;
    } catch (error) {
      Logger.error("Error getting file from Telegram", error);
      if (axios.isAxiosError(error)) {
        throw new TelegramAPIError(`Failed to get file: ${error.message}`, error.response?.status);
      }
      throw error;
    }
  }

  async downloadFile(filePath: string): Promise<Buffer> {
    try {
      const url = `https://api.telegram.org/file/bot${this.token}/${filePath}`;
      const response = await axios.get(url, {
        responseType: "arraybuffer",
      });
      return Buffer.from(response.data);
    } catch (error) {
      Logger.error("Error downloading file from Telegram", error);
      if (axios.isAxiosError(error)) {
        throw new TelegramAPIError(
          `Failed to download file: ${error.message}`,
          error.response?.status
        );
      }
      throw error;
    }
  }

  async sendPhoto(chatId: number, photoBuffer: Buffer, caption?: string): Promise<void> {
    try {
      const form = new FormData();
      form.append("chat_id", chatId.toString());
      const blob = new Blob([photoBuffer], { type: "image/png" });
      form.append("photo", blob, "chart.png");
      if (caption) form.append("caption", caption);

      await axios.post(`${this.baseUrl}/sendPhoto`, form);
    } catch (error) {
      Logger.error("Error sending photo to Telegram", error);
      if (axios.isAxiosError(error)) {
        throw new TelegramAPIError(
          `Failed to send photo: ${error.message}`,
          error.response?.status
        );
      }
      throw error;
    }
  }

  async setWebhook(url: string): Promise<void> {
    try {
      await axios.post(`${this.baseUrl}/setWebhook`, { url });
      Logger.log(`Webhook set to: ${url}`);
    } catch (error) {
      Logger.error("Error setting webhook", error);
      if (axios.isAxiosError(error)) {
        throw new TelegramAPIError(
          `Failed to set webhook: ${error.message}`,
          error.response?.status
        );
      }
      throw error;
    }
  }
}
