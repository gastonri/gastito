import { MONTH_NAMES_ES } from "../../utils/months";
import { CommandHandler } from "./types";

export const handlePresupuesto: CommandHandler = async ({
  chatId,
  telegramClient,
  sheetsClient,
}) => {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const monthName = MONTH_NAMES_ES[month - 1];

  try {
    const [presupuestos, gastos] = await Promise.all([
      sheetsClient.getPresupuestos(),
      sheetsClient.getGastosDelMes(year, month),
    ]);

    if (presupuestos.length === 0) {
      await telegramClient.sendMessage(
        chatId,
        "❌ No hay presupuestos configurados. Agregá una hoja *PRESUPUESTOS* con columnas `categoria` y `monto`."
      );
      return;
    }

    const gastado = new Map<string, number>();
    for (const g of gastos) {
      gastado.set(g.macro_categoria, (gastado.get(g.macro_categoria) ?? 0) + g.monto);
    }

    const sep = "━━━━━━━━━━━━━━━";
    let msg = `📊 *Presupuestos de ${monthName}*\n${sep}\n`;
    for (const { macro_categoria, monto } of presupuestos) {
      const gastadoCategoria = gastado.get(macro_categoria) ?? 0;
      const pct = Math.round((gastadoCategoria / monto) * 100);
      const alerta = pct >= 100 ? " ⚠️" : "";
      msg += `${macro_categoria}\n   $${gastadoCategoria.toLocaleString("es-AR")} / $${monto.toLocaleString("es-AR")}  _(${pct}%)_${alerta}\n`;
    }
    msg += sep;

    await telegramClient.sendMessage(chatId, msg);
  } catch {
    await telegramClient.sendMessage(chatId, "❌ No se pudo leer la planilla. Intentá de nuevo.");
  }
};
