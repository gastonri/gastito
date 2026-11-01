import { sessionManager } from "../../services/session-manager";
import { ClarificationBuilder } from "../clarification-builder";
import { Messages } from "../messages";
import { escapeMarkdown, formatMoney } from "../../utils/format";
import { CommandHandler } from "./types";

/** Shows what the last confirmation wrote and asks before removing it (dz_undo callback). */
export const handleDeshacer: CommandHandler = async ({ chatId, telegramClient }) => {
  const batch = await sessionManager.getLastBatch(chatId);

  if (!batch || batch.length === 0) {
    await telegramClient.sendMessage(chatId, Messages.undoNothing);
    return;
  }

  const lines = batch
    .map((w) => `• ${escapeMarkdown(w.descripcion)} · $${formatMoney(w.monto)}`)
    .join("\n");

  await telegramClient.sendMessage(
    chatId,
    Messages.undoAsk(lines),
    ClarificationBuilder.buildDangerKeyboard("undo")
  );
};
