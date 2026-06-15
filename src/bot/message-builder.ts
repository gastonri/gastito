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
      `🤔 *¿Confirmás este gasto?*\n\n` +
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

  static buildMultiConfirmationMessage(gastos: TransactionResult[]): string {
    const total = gastos.reduce((sum, g) => sum + (g.datos.monto || 0), 0);
    const moneda = gastos[0]?.datos.moneda || "ARS";
    const sep = "━━━━━━━━━━━━━━━";

    let mensaje = `🤔 *¿Confirmás estos ${gastos.length} gastos?*\n`;
    gastos.forEach((g) => {
      const d = g.datos;
      const miParte = d.mi_parte !== undefined ? d.mi_parte : 100;
      const extras: string[] = [];
      if (miParte < 100) extras.push(`${miParte}% mi parte`);
      if (d.cuotas && d.cuotas > 1) extras.push(`${d.cuotas} cuotas`);

      mensaje += `${sep}\n`;
      mensaje += `🧾 ${escapeMarkdown(d.descripcion)}\n`;
      mensaje += `   $${d.monto} ${d.moneda || "ARS"}`;
      if (d.fecha) mensaje += ` · ${d.fecha}`;
      if (d.persona) mensaje += ` · ${escapeMarkdown(d.persona)}`;
      mensaje += `\n`;
      mensaje += `   ${d.macro_categoria} → ${d.subcategoria}`;
      if (extras.length) mensaje += ` · ${extras.join(" · ")}`;
      mensaje += `\n`;
    });
    mensaje += `${sep}\n`;
    mensaje += `Total: $${total} ${moneda}`;

    return mensaje;
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
