import { TransactionResult } from "../types";
import { escapeMarkdown, formatAmount, formatMoney, formatFecha } from "../utils/format";
import { Messages } from "./messages";

function totalsFooter(items: TransactionResult[]): string {
  const hasGasto = items.some((g) => g.tipo === "GASTO");
  const hasIngreso = items.some((g) => g.tipo === "INGRESO");
  const totalGastos = items
    .filter((g) => g.tipo === "GASTO")
    .reduce((sum, g) => sum + (g.datos.monto || 0), 0);
  const totalIngresos = items
    .filter((g) => g.tipo === "INGRESO")
    .reduce((sum, g) => sum + (g.datos.monto || 0), 0);
  const moneda = items[0]?.datos.moneda || "ARS";

  if (hasGasto && hasIngreso) {
    return (
      `Ingresos: $${formatMoney(totalIngresos)} ${moneda}\n` +
      `Gastos: $${formatMoney(totalGastos)} ${moneda}\n` +
      `Neto: $${formatMoney(totalIngresos - totalGastos)} ${moneda}`
    );
  }
  return `Total: $${formatMoney(hasIngreso ? totalIngresos : totalGastos)} ${moneda}`;
}

export class MessageBuilder {
  static buildConfirmationMessage(data: TransactionResult): string {
    const d = data.datos;
    const alerta = data.alerta ? `\n\n${escapeMarkdown(data.alerta)}` : "";
    const descripcion = escapeMarkdown(d.descripcion);
    const notas = escapeMarkdown(d.notas);

    let mensaje: string;

    if (data.tipo === "INGRESO") {
      mensaje =
        `${Messages.confirmTitle}\n\n` +
        `📝 *Descripción:* ${descripcion}\n` +
        `💵 *Monto:* ${formatAmount(d.monto, d.moneda)}\n` +
        `📅 *Fecha:* ${formatFecha(d.fecha)}\n` +
        `🏷️ *Categoría:* ${d.categoria}\n` +
        `👤 *Persona:* ${d.persona || "—"}` +
        (notas ? `\n📋 *Notas:* ${notas}` : "") +
        alerta;
    } else {
      const miParte = d.mi_parte !== undefined ? d.mi_parte : 100;
      mensaje =
        `${Messages.confirmTitle}\n\n` +
        `📝 *Descripción:* ${descripcion}\n` +
        `💵 *Monto:* ${formatAmount(d.monto, d.moneda)}\n` +
        `📅 *Fecha:* ${formatFecha(d.fecha)}\n` +
        `🏷️ *Categoría:* ${d.macro_categoria}\n` +
        `🔖 *Subcategoría:* ${d.subcategoria}\n` +
        `👤 *Persona:* ${d.persona || "—"}` +
        (miParte < 100 ? `\n💰 *Mi parte:* ${miParte}%` : "") +
        (d.cuotas && d.cuotas > 1 ? `\n💳 *Cuotas:* ${d.cuotas} (cuota ${d.n_cuota || 1})` : "") +
        (notas ? `\n📋 *Notas:* ${notas}` : "") +
        alerta;
    }

    if (data.duplicado) {
      mensaje += `\n\n${Messages.duplicateWarning}`;
    }

    if (data.usa_contexto) {
      mensaje += `\n\n${Messages.usingContext}`;
    }

    return mensaje;
  }

  // Telegram's sendMessage/editMessageText hard-cap text at 4096 chars; stay under it
  // with margin for the footer/truncation note so large receipts never fail to send.
  private static readonly MAX_MESSAGE_LENGTH = 4000;

  static buildMultiConfirmationMessage(gastos: TransactionResult[]): string {
    const sep = "━━━━━━━━━━━━━━━";
    const footer = `${sep}\n${totalsFooter(gastos)}`;

    let mensaje = `${Messages.confirmMultiTitle(gastos.length)}\n`;
    let shown = 0;

    for (const g of gastos) {
      const d = g.datos;
      const isIngreso = g.tipo === "INGRESO";
      const extras: string[] = [];
      if (!isIngreso) {
        const miParte = d.mi_parte !== undefined ? d.mi_parte : 100;
        if (miParte < 100) extras.push(`${miParte}% mi parte`);
        if (d.cuotas && d.cuotas > 1) extras.push(`${d.cuotas} cuotas`);
      }

      let item = `${sep}\n`;
      item += `${isIngreso ? "💰" : "🧾"} ${escapeMarkdown(d.descripcion)}\n`;
      item += `   ${formatAmount(d.monto, d.moneda)}`;
      if (d.fecha) item += ` · ${formatFecha(d.fecha)}`;
      if (d.persona) item += ` · ${escapeMarkdown(d.persona)}`;
      item += `\n`;
      item += isIngreso ? `   ${d.categoria}` : `   ${d.macro_categoria} → ${d.subcategoria}`;
      if (extras.length) item += ` · ${extras.join(" · ")}`;
      item += `\n`;
      if (g.duplicado) item += `   ${Messages.duplicateShort}\n`;

      if (mensaje.length + item.length + footer.length > this.MAX_MESSAGE_LENGTH) {
        mensaje += `${sep}\n… y ${gastos.length - shown} más (se guardan igual al confirmar)\n`;
        break;
      }

      mensaje += item;
      shown++;
    }

    mensaje += footer;
    return mensaje;
  }

  static buildSuccessMessage(saved: TransactionResult[], failedCount: number): string {
    const failureNote = failedCount > 0 ? `\n\n${Messages.partialFailure(failedCount)}` : "";

    if (saved.length === 1) {
      const g = saved[0];
      const d = g.datos;
      const isIngreso = g.tipo === "INGRESO";
      let msg = `✅ *Anotado*\n\n`;
      msg += `${escapeMarkdown(d.descripcion)} · ${formatAmount(d.monto, d.moneda)}\n`;
      msg += isIngreso ? `${d.categoria}` : `${d.macro_categoria} → ${d.subcategoria}`;
      if (d.fecha) msg += ` · ${formatFecha(d.fecha)}`;
      if (d.persona) msg += ` · ${escapeMarkdown(d.persona)}`;
      return msg + failureNote;
    }

    const footer = `\n${totalsFooter(saved)}${failureNote}`;

    let msg = `✅ *${saved.length} movimientos anotados*\n\n`;
    let shown = 0;

    for (const g of saved) {
      let line = `${escapeMarkdown(g.datos.descripcion)} · ${formatAmount(g.datos.monto, g.datos.moneda)}`;
      if (g.datos.fecha) line += ` · ${formatFecha(g.datos.fecha)}`;
      line += `\n`;

      if (msg.length + line.length + footer.length > this.MAX_MESSAGE_LENGTH) {
        msg += `… y ${saved.length - shown} más\n`;
        break;
      }

      msg += line;
      shown++;
    }

    return msg + footer;
  }

  static buildContextSummary(context: {
    tipo: string;
    datos: import("../types").TransactionData;
  }): string {
    const d = context.datos;
    const categoriaLine =
      context.tipo === "INGRESO"
        ? `🏷️ ${d.categoria}`
        : `🏷️ ${d.macro_categoria} → ${d.subcategoria}`;
    return (
      `📝 ${d.descripcion} - $${formatMoney(d.monto)}\n` +
      `${categoriaLine}\n` +
      `📅 ${formatFecha(d.fecha)}` +
      (d.persona ? `\n👤 ${d.persona}` : "")
    );
  }
}
