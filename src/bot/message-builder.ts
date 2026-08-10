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

    let mensaje: string;

    if (data.tipo === "INGRESO") {
      mensaje =
        `🤔 *${descripcion} — ¿lo anoto?*\n\n` +
        `📝 *Descripción:* ${descripcion}\n` +
        `💵 *Monto:* $${d.monto} ${d.moneda || "ARS"}\n` +
        `📅 *Fecha:* ${d.fecha || "Hoy"}\n` +
        `🏷️ *Categoría:* ${d.categoria}\n` +
        `👤 *Persona:* ${d.persona || "—"}` +
        (notas ? `\n📋 *Notas:* ${notas}` : "") +
        alerta;
    } else {
      const miParte = d.mi_parte !== undefined ? d.mi_parte : 100;
      mensaje =
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
    }

    if (data.usa_contexto) {
      mensaje += `\n\n💭 *Usando contexto del último registro confirmado*`;
    }

    return mensaje;
  }

  // Telegram's sendMessage/editMessageText hard-cap text at 4096 chars; stay under it
  // with margin for the footer/truncation note so large receipts never fail to send.
  private static readonly MAX_MESSAGE_LENGTH = 4000;

  static buildMultiConfirmationMessage(gastos: TransactionResult[]): string {
    const hasGasto = gastos.some((g) => g.tipo === "GASTO");
    const hasIngreso = gastos.some((g) => g.tipo === "INGRESO");
    const totalGastos = gastos
      .filter((g) => g.tipo === "GASTO")
      .reduce((sum, g) => sum + (g.datos.monto || 0), 0);
    const totalIngresos = gastos
      .filter((g) => g.tipo === "INGRESO")
      .reduce((sum, g) => sum + (g.datos.monto || 0), 0);
    const moneda = gastos[0]?.datos.moneda || "ARS";
    const sep = "━━━━━━━━━━━━━━━";

    let footer = `${sep}\n`;
    if (hasGasto && hasIngreso) {
      footer +=
        `Ingresos: $${totalIngresos} ${moneda}\n` +
        `Gastos: $${totalGastos} ${moneda}\n` +
        `Neto: $${totalIngresos - totalGastos} ${moneda}`;
    } else if (hasIngreso) {
      footer += `Total: $${totalIngresos} ${moneda}`;
    } else {
      footer += `Total: $${totalGastos} ${moneda}`;
    }

    let mensaje = `🤔 *¿Confirmás estos ${gastos.length} movimientos?*\n`;
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
      item += `   $${d.monto} ${d.moneda || "ARS"}`;
      if (d.fecha) item += ` · ${d.fecha}`;
      if (d.persona) item += ` · ${escapeMarkdown(d.persona)}`;
      item += `\n`;
      item += isIngreso ? `   ${d.categoria}` : `   ${d.macro_categoria} → ${d.subcategoria}`;
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
    const failureNote =
      failedCount > 0 ? `\n\n⚠️ ${failedCount} movimiento(s) no se pudieron guardar.` : "";

    if (saved.length === 1) {
      const g = saved[0];
      const d = g.datos;
      const isIngreso = g.tipo === "INGRESO";
      let msg = `✅ *Anotado*\n\n`;
      msg += `${escapeMarkdown(d.descripcion)} · $${d.monto} ${d.moneda || "ARS"}\n`;
      msg += isIngreso ? `${d.categoria}` : `${d.macro_categoria} → ${d.subcategoria}`;
      if (d.fecha) msg += ` · ${d.fecha}`;
      if (d.persona) msg += ` · ${escapeMarkdown(d.persona)}`;
      return msg + failureNote;
    }

    const hasGasto = saved.some((g) => g.tipo === "GASTO");
    const hasIngreso = saved.some((g) => g.tipo === "INGRESO");
    const totalGastos = saved
      .filter((g) => g.tipo === "GASTO")
      .reduce((sum, g) => sum + (g.datos.monto || 0), 0);
    const totalIngresos = saved
      .filter((g) => g.tipo === "INGRESO")
      .reduce((sum, g) => sum + (g.datos.monto || 0), 0);
    const moneda = saved[0]?.datos.moneda || "ARS";

    let footer = "\n";
    if (hasGasto && hasIngreso) {
      footer +=
        `Ingresos: $${totalIngresos} ${moneda}\n` +
        `Gastos: $${totalGastos} ${moneda}\n` +
        `Neto: $${totalIngresos - totalGastos} ${moneda}`;
    } else if (hasIngreso) {
      footer += `Total: $${totalIngresos} ${moneda}`;
    } else {
      footer += `Total: $${totalGastos} ${moneda}`;
    }
    footer += failureNote;

    let msg = `✅ *${saved.length} movimientos anotados*\n\n`;
    let shown = 0;

    for (const g of saved) {
      let line = `${escapeMarkdown(g.datos.descripcion)} · $${g.datos.monto} ${g.datos.moneda || "ARS"}`;
      if (g.datos.fecha) line += ` · ${g.datos.fecha}`;
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

  static buildContextSummary(context: { tipo: string; datos: import("../types").TransactionData }): string {
    const d = context.datos;
    const categoriaLine =
      context.tipo === "INGRESO" ? `🏷️ ${d.categoria}` : `🏷️ ${d.macro_categoria} → ${d.subcategoria}`;
    return (
      `📝 ${d.descripcion} - $${d.monto}\n` +
      `${categoriaLine}\n` +
      `📅 ${d.fecha || "Hoy"}` +
      (d.persona ? `\n👤 ${d.persona}` : "")
    );
  }
}
