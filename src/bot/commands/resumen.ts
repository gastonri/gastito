import { MONTH_NAMES_ES } from "../../utils/months";
import { CommandHandler } from "./types";

export const handleResumen: CommandHandler = async ({ chatId, telegramClient, sheetsClient }) => {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const monthName = MONTH_NAMES_ES[month - 1];

  try {
    const gastos = await sheetsClient.getGastosDelMes(year, month);

    if (gastos.length === 0) {
      await telegramClient.sendMessage(chatId, `📊 No hay gastos registrados en ${monthName}.`);
      return;
    }

    const totales = new Map<string, number>();
    for (const g of gastos) {
      totales.set(g.macro_categoria, (totales.get(g.macro_categoria) ?? 0) + g.monto);
    }

    const ordenados = [...totales.entries()].sort((a, b) => b[1] - a[1]);
    const total = ordenados.reduce((sum, [, v]) => sum + v, 0);

    const sep = "━━━━━━━━━━━━━━━";
    let msg = `📊 *Gastos de ${monthName}*\n${sep}\n`;
    for (const [cat, monto] of ordenados) {
      const pct = Math.round((monto / total) * 100);
      msg += `${cat}\n   $${monto.toLocaleString("es-AR")} _(${pct}%)_\n`;
    }
    msg += `${sep}\nTotal: $${total.toLocaleString("es-AR")} ARS`;

    await telegramClient.sendMessage(chatId, msg);
  } catch {
    await telegramClient.sendMessage(chatId, "❌ No se pudo leer la planilla. Intentá de nuevo.");
  }
};
