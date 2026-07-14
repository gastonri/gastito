import { TransactionResult } from "../types";

function escapeMarkdown(text: string | undefined): string {
  if (!text) return "";
  return text.replace(/([_*`[])/g, "\\$1");
}

export class MessageBuilder {
  static buildConfirmationMessage(data: TransactionResult): string {
    const d = data.datos;
    const alerta = data.alerta ? `\n\n${escapeMarkdown(data.alerta)}` : "";
    const descripcion = escapeMarkdown(d.descripcion);
    const notas = escapeMarkdown(d.notas);
    const miParte = d.mi_parte !== undefined ? d.mi_parte : 100;

    let mensaje =
      `🤔 *${descripcion} — ¿lo anoto?*\n\n` +
      `📝 *Descripción:* ${descripcion}\n` +
      `💵 *Monto:* $${d.monto} ${d.moneda || "ARS"}\n` +
      `📅 *Fecha:* ${d.fecha || "Hoy"}\n` +
      `🏷️ *Categoría:* ${d.macro_categoria}\n` +
      `🔖 *Subcategoría:* ${d.subcategoria}\n` +
      `👤 *Persona:* ${d.persona || "—"}` +
      (miParte < 100 ? `\n💰 *Mi parte:* ${miParte}%` : "") +
      (d.cuotas && d.cuotas > 1 ? `\n💳 *Cuotas:* ${d.cuotas} (cuota ${d.n_cuota || 1})` : "") +
      (notas ? `\n📋 *Notas:* ${notas}` : "") +
      alerta;

    if (data.usa_contexto) {
      mensaje += `\n\n💭 *Usando contexto del último registro confirmado*`;
    }

    return mensaje;
  }

  // Telegram's sendMessage/editMessageText hard-cap text at 4096 chars; stay under it
  // with margin for the footer/truncation note so large receipts never fail to send.
  private static readonly MAX_MESSAGE_LENGTH = 4000;

  static buildMultiConfirmationMessage(gastos: TransactionResult[]): string {
    const total = gastos.reduce((sum, g) => sum + (g.datos.monto || 0), 0);
    const moneda = gastos[0]?.datos.moneda || "ARS";
    const sep = "━━━━━━━━━━━━━━━";
    const footer = `${sep}\nTotal: $${total} ${moneda}`;

    let mensaje = `🤔 *¿Confirmás estos ${gastos.length} gastos?*\n`;
    let shown = 0;

    for (const g of gastos) {
      const d = g.datos;
      const miParte = d.mi_parte !== undefined ? d.mi_parte : 100;
      const extras: string[] = [];
      if (miParte < 100) extras.push(`${miParte}% mi parte`);
      if (d.cuotas && d.cuotas > 1) extras.push(`${d.cuotas} cuotas`);

      let item = `${sep}\n`;
      item += `🧾 ${escapeMarkdown(d.descripcion)}\n`;
      item += `   $${d.monto} ${d.moneda || "ARS"}`;
      if (d.fecha) item += ` · ${d.fecha}`;
      if (d.persona) item += ` · ${escapeMarkdown(d.persona)}`;
      item += `\n`;
      item += `   ${d.macro_categoria} → ${d.subcategoria}`;
      if (extras.length) item += ` · ${extras.join(" · ")}`;
      item += `\n`;

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
    const failureNote = failedCount > 0 ? `\n\n⚠️ ${failedCount} gasto(s) no se pudieron guardar.` : "";

    if (saved.length === 1) {
      const d = saved[0].datos;
      let msg = `✅ *Anotado*\n\n`;
      msg += `${escapeMarkdown(d.descripcion)} · $${d.monto} ${d.moneda || "ARS"}\n`;
      msg += `${d.macro_categoria} → ${d.subcategoria}`;
      if (d.fecha) msg += ` · ${d.fecha}`;
      if (d.persona) msg += ` · ${escapeMarkdown(d.persona)}`;
      return msg + failureNote;
    }

    const total = saved.reduce((sum, g) => sum + (g.datos.monto || 0), 0);
    const moneda = saved[0]?.datos.moneda || "ARS";
    const footer = `\nTotal: $${total} ${moneda}` + failureNote;

    let msg = `✅ *${saved.length} gastos anotados*\n\n`;
    let shown = 0;

    for (const g of saved) {
      const line = `${escapeMarkdown(g.datos.descripcion)} · $${g.datos.monto} ${g.datos.moneda || "ARS"}\n`;

      if (msg.length + line.length + footer.length > this.MAX_MESSAGE_LENGTH) {
        msg += `… y ${saved.length - shown} más\n`;
        break;
      }

      msg += line;
      shown++;
    }

    return msg + footer;
  }

  static buildContextSummary(context: { tipo: string; datos: import("../types").TransactionData }): string {
    const d = context.datos;
    return (
      `📝 ${d.descripcion} - $${d.monto}\n` +
      `🏷️ ${d.macro_categoria} → ${d.subcategoria}\n` +
      `📅 ${d.fecha || "Hoy"}` +
      (d.persona ? `\n👤 ${d.persona}` : "")
    );
  }
}
