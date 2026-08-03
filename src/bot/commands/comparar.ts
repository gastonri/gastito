import { Logger } from "../../utils/logger";
import { ChartService } from "../../services/chart";
import { MONTH_NAMES_ES_CAP, Period, previousPeriod, resolveMonthName } from "../../utils/months";
import { CommandHandler } from "./types";

export const handleComparar: CommandHandler = async ({
  chatId,
  text,
  telegramClient,
  sheetsClient,
}) => {
  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();
  const args = text
    .trim()
    .split(/\s+/)
    .slice(1)
    .map((p) => p.toLowerCase());

  const resolveMonth = (name: string): Period | null =>
    resolveMonthName(name, currentMonth, currentYear);

  let periodA: Period;
  let periodB: Period;

  if (args.length === 0) {
    periodA = { year: currentYear, month: currentMonth };
    periodB = previousPeriod(periodA);
  } else if (args.length === 1) {
    const resolved = resolveMonth(args[0]);
    if (!resolved) {
      await telegramClient.sendMessage(
        chatId,
        "❌ Mes inválido. Ejemplo: `/comparar julio` o `/comparar julio junio`"
      );
      return;
    }
    periodA = resolved;
    periodB = previousPeriod(periodA);
  } else {
    const resolvedA = resolveMonth(args[0]);
    const resolvedB = resolveMonth(args[1]);
    if (!resolvedA || !resolvedB) {
      await telegramClient.sendMessage(chatId, "❌ Mes inválido. Ejemplo: `/comparar julio junio`");
      return;
    }
    periodA = resolvedA;
    periodB = resolvedB;
  }

  telegramClient.sendChatAction(chatId, "upload_photo");
  try {
    const [gastosA, gastosB] = await Promise.all([
      sheetsClient.getGastosDelMes(periodA.year, periodA.month),
      sheetsClient.getGastosDelMes(periodB.year, periodB.month),
    ]);

    if (gastosA.length === 0 && gastosB.length === 0) {
      await telegramClient.sendMessage(
        chatId,
        "📊 No hay gastos registrados en ninguno de los dos meses."
      );
      return;
    }

    const chartBuffer = await ChartService.generateComparisonChart(
      periodA,
      periodB,
      gastosA,
      gastosB
    );
    const labelA = `${MONTH_NAMES_ES_CAP[periodA.month - 1]} ${periodA.year}`;
    const labelB = `${MONTH_NAMES_ES_CAP[periodB.month - 1]} ${periodB.year}`;
    await telegramClient.sendPhoto(chatId, chartBuffer, `📊 Comparativa: ${labelA} vs ${labelB}`);
  } catch (error) {
    Logger.error("Error generating comparison chart", error instanceof Error ? error : null);
    await telegramClient.sendMessage(
      chatId,
      "❌ No se pudo generar la comparativa. Intentá de nuevo."
    );
  }
};
