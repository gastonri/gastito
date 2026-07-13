import { Logger } from "../../utils/logger";
import { ChartService } from "../../services/chart";
import { MONTH_NAMES_ES } from "../../utils/months";
import { CommandHandler } from "./types";

export const handleGrafico: CommandHandler = async ({ chatId, telegramClient, sheetsClient }) => {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const monthName = MONTH_NAMES_ES[month - 1];

  telegramClient.sendChatAction(chatId, "upload_photo");
  try {
    const gastosPorDia = await sheetsClient.getGastosPorDiaDelMes(year, month);

    if (gastosPorDia.length === 0) {
      await telegramClient.sendMessage(chatId, `📊 No hay gastos registrados en ${monthName}.`);
      return;
    }

    const chartBuffer = await ChartService.generateDailyExpensesChart(year, month, gastosPorDia);
    await telegramClient.sendPhoto(chatId, chartBuffer, `📊 Gastos de ${monthName} ${year}`);
  } catch (error) {
    Logger.error("Error generating chart", error instanceof Error ? error : null);
    await telegramClient.sendMessage(chatId, "❌ No se pudo generar el gráfico. Intentá de nuevo.");
  }
};
