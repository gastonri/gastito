import { CommandHandler } from "./types";
import { ClarificationBuilder } from "../clarification-builder";
import { Messages } from "../messages";

/** Destructive: asks for confirmation. The actual cleanup runs in the dz_ callback. */
export const handleExit: CommandHandler = async ({ chatId, telegramClient }) => {
  await telegramClient.sendMessage(
    chatId,
    Messages.exitAsk,
    ClarificationBuilder.buildDangerKeyboard("exit")
  );
};
