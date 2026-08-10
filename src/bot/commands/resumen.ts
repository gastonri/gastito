import { MONTH_NAMES_ES_CAP, parsePeriodArgs } from "../../utils/months";
import { CommandHandler } from "./types";

export const handleResumen: CommandHandler = async ({
  chatId,
  text,
  telegramClient,
  sheetsClient,
}) => {
  const args = text.trim().split(/\s+/).slice(1);
  const period = parsePeriodArgs(args);

  if (!period) {
    await telegramClient.sendMessage(
      chatId,
      "❌ Mes inválido. Ejemplo: `/resumen julio` o `/resumen julio 2025`"
    );
    return;
  }

  const { year, month } = period;
  const monthName = `${MONTH_NAMES_ES_CAP[month - 1]} ${year}`;

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

    const cuadernoContable = await sheetsClient.getCuadernoContableDelMes(year, month);

    const sep = "━━━━━━━━━━━━━━━";
    let msg = `📊 *Gastos de ${monthName}*\n${sep}\n`;
    for (const [cat, monto] of ordenados) {
      const pct = Math.round((monto / total) * 100);
      msg += `${cat}\n   $${monto.toLocaleString("es-AR")} _(${pct}%)_\n`;
    }
    msg += `${sep}\nTotal: $${total.toLocaleString("es-AR")} ARS`;

    if (cuadernoContable) {
      msg +=
        `\n${sep}\n` +
        `Neto del mes: $${cuadernoContable.neto_mes.toLocaleString("es-AR")} ARS\n` +
        `Acumulado: $${cuadernoContable.acumulado.toLocaleString("es-AR")} ARS`;
    }

    await telegramClient.sendMessage(chatId, msg);
  } catch {
    await telegramClient.sendMessage(chatId, "❌ No se pudo leer la planilla. Intentá de nuevo.");
  }
};
