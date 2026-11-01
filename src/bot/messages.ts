/**
 * Centralized user-facing strings (Spanish, voseo rioplatense).
 * Keep tone consistent here instead of scattering literals across handlers.
 */
import { escapeMarkdown } from "../utils/format";

export const Messages = {
  // Loading states
  loadingText: "💬 Procesando...",
  loadingPhoto: "📸 Analizando el comprobante (puede tardar unos segundos)...",
  loadingAudio: "🎤 Transcribiendo el audio...",
  transcription: (text: string) =>
    `🎤 *Transcripción:*\n\n"${escapeMarkdown(text)}"\n\n💬 Procesando...`,
  unsupportedMessage: "❌ Solo puedo procesar texto, fotos de comprobantes o audios.",

  // Errors
  genericError: "❌ Ocurrió un error al procesar tu mensaje. Intentá de nuevo en unos segundos.",
  quotaExceededRetry: (seconds: number) =>
    `⚠️ *Límite de cuota alcanzado*\n\nSe agotó la cuota de la API de Gemini por ahora.\n\nIntentá de nuevo en ${seconds} segundos.`,
  quotaExceeded:
    "⚠️ *Límite de cuota alcanzado*\n\nSe agotó la cuota diaria de la API de Gemini.\n\nIntentá de nuevo más tarde o mañana.",
  noTransactionFound:
    "🤷 No pude identificar ningún movimiento.\n\nProbá con algo como: `almuerzo 4500` o mandame una foto del ticket.",
  transcriptionFailed:
    "🎤 No pude entender el audio.\n\nGrabalo de nuevo hablando claro y en español, o escribime el movimiento.",
  aiUnavailable:
    "🤖 No pude analizar el mensaje en este momento.\n\nIntentá de nuevo en unos segundos.",
  networkError: "📡 Hubo un problema de conexión.\n\nIntentá de nuevo en unos segundos.",

  // Confirmation flow
  confirmTitle: "🤔 *¿Lo anoto?*",
  confirmMultiTitle: (n: number) => `🤔 *¿Confirmás estos ${n} movimientos?*`,
  usingContext: "💭 *Usando contexto del último registro confirmado*",
  editHint:
    "✏️ *¿Qué querés corregir?*\n\nMandame un mensaje con el cambio y actualizo el registro pendiente. Por ejemplo:\n• `el monto es 15000`\n• `la categoría es Supermercado`\n• `la fecha es 28/10`",
  editToast: "Mandame la corrección",

  // Callback results
  operationExpired:
    "⏱️ Esta operación expiró (pasan más de 30 minutos sin confirmar).\n\nReenviame el gasto o ingreso y lo cargo de nuevo.",
  operationExpiredToast: "Operación expirada",
  cancelled:
    "🗑️ *Operación cancelada*\n\nNo se guardó nada. Cuando quieras, mandame otro movimiento.",
  cancelledToast: "Cancelado, no se guardó nada",
  sessionExpired: "⏱️ Tu sesión expiró.\n\nReenviame el movimiento y empezamos de nuevo.",
  sessionExpiredToast: "Sesión expirada",
  internalErrorToast: "Ocurrió un error, intentá de nuevo",
  saved: "✓ Guardado",
  saveFailed:
    "❌ *No pude guardar el movimiento*\n\nTu registro sigue pendiente, no se perdió nada. Podés reintentar o cancelar.",
  saveFailedToast: "No se pudo guardar",
  partialFailure: (n: number) => `⚠️ ${n} movimiento(s) no se pudieron guardar.`,
  clarificationError: "❌ No pude procesar tu respuesta. Mandame el movimiento de nuevo.",

  // Destructive commands
  resetAsk: "🔄 *¿Limpiar el contexto?*\n\nSe borra el último registro y la conversación en curso.",
  resetDone: "🔄 *Contexto limpiado*\n\nEmpezando conversación nueva.",
  exitAsk: "👋 *¿Terminar la sesión?*\n\nSe borra la conversación en curso y el contexto.",
  exitDone: "👋 *Sesión terminada*\n\nPodés empezar de nuevo cuando quieras.",
  dangerAborted: "👍 Listo, no cambié nada.",
  dangerAbortedToast: "Sin cambios",

  // Category change
  categoryPickItem: "🏷️ *¿A cuál movimiento le cambiás la categoría?*",
  categoryPickMacro: (descripcion: string, actual: string) =>
    `🏷️ *Categoría de "${descripcion}"*\nActual: ${actual}\n\nElegí la categoría:`,
  categoryPickSub: (macro: string) => `🏷️ *${macro}*\n\nElegí la subcategoría:`,
  categoryPickIngreso: (descripcion: string, actual: string) =>
    `🏷️ *Categoría de "${descripcion}"*\nActual: ${actual}\n\nElegí la categoría:`,
  categoryChangedToast: "Categoría actualizada",

  // Dollar rate
  fxToBlue: "💱 Cambiar a dólar blue",
  fxToTarjeta: "💱 Cambiar a dólar tarjeta",
  fxChangedToast: (tipo: string) => `Ahora usa dólar ${tipo}`,

  // Undo
  undoNothing:
    "🤷 No tengo nada para deshacer.\n\nSolo puedo deshacer la última confirmación, dentro de las 24 horas.",
  undoAsk: (lines: string) =>
    `↩️ *¿Deshacer el último registro?*\n\nSe van a borrar de la planilla:\n${lines}`,
  undoDone: (deleted: number) =>
    deleted === 1
      ? "↩️ *Listo, borré el registro de la planilla.*"
      : `↩️ *Listo, borré ${deleted} registros de la planilla.*`,
  undoPartial: (deleted: number, skipped: number) =>
    `⚠️ Borré ${deleted} registro(s), pero ${skipped} no los toqué porque cambiaron en la planilla. Revisalos a mano.`,
  undoFailed: "❌ No pude deshacer. Revisá la planilla a mano.",
  undoToast: "Deshecho",

  // Duplicates
  duplicateWarning:
    "⚠️ *Posible duplicado:* ya hay un gasto con la misma fecha, monto y descripción en la planilla.",
  duplicateShort: "⚠️ posible duplicado",

  // Budget
  budgetLine: (categoria: string, pct: number, gastado: string, presupuesto: string) => {
    const icon = pct >= 100 ? "🚨" : pct >= 80 ? "⚠️" : "📊";
    return `${icon} ${escapeMarkdown(categoria)}: ${pct}% del presupuesto ($${gastado} / $${presupuesto})`;
  },
};

/** Button labels. */
export const Buttons = {
  confirm: "✅ Confirmar",
  cancel: "🗑️ Cancelar",
  edit: "✏️ Editar",
  category: "🏷️ Categoría",
  back: "⬅️ Volver",
  retry: "🔁 Reintentar",
  yesReset: "Sí, limpiar",
  yesExit: "Sí, terminar",
  yesUndo: "Sí, deshacer",
  no: "No, volver",
};
