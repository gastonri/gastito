import { TelegramClient } from "../telegram";
import { SheetsClient } from "../../sheets/client";
import { UserPreferencesService } from "../../services/user-preferences";

export interface CommandContext {
  chatId: number;
  text: string;
  telegramClient: TelegramClient;
  sheetsClient: SheetsClient;
  userPreferences: UserPreferencesService;
}

export type CommandHandler = (ctx: CommandContext) => Promise<void>;
