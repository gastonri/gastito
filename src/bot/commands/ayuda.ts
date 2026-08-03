import { CommandHandler } from "./types";

export const handleAyuda: CommandHandler = async ({ chatId, telegramClient }) => {
  await telegramClient.sendMessage(
    chatId,
    "*Gastito — comandos disponibles*\n\n" +
      "Mandá texto, una foto de ticket o un audio y el bot detecta automáticamente si es un gasto, ingreso o transferencia.\n\n" +
      "*Comandos*\n" +
      "`/ayuda` — muestra este mensaje\n" +
      "`/resumen` — gastos del mes agrupados por categoría\n" +
      "`/resumen <mes>` o `/resumen <mes> <año>` — resumen de un mes específico\n" +
      "`/grafico` — gráfico de barras con gasto diario y acumulado del mes\n" +
      "`/comparar` — compara gastos por categoría del mes actual vs. el anterior\n" +
      "`/comparar <mes>` o `/comparar <mes1> <mes2>` — compara meses específicos\n" +
      "`/presupuesto` — gasto del mes vs. presupuesto por categoría\n" +
      "`/presupuesto <mes>` o `/presupuesto <mes> <año>` — presupuesto de un mes específico\n" +
      "`/contexto` — muestra el último registro confirmado\n" +
      "`/model` — muestra el modelo de IA actual\n" +
      "`/model gemini` o `/model anthropic` — cambia el modelo\n" +
      "`/nuevo` o `/reset` — limpia el contexto y empieza de cero\n" +
      "`/exit` — termina la sesión actual\n\n" +
      "*Consejos*\n" +
      "• Podés mandar varios gastos en un solo mensaje\n" +
      "• Las fotos de tickets se analizan automáticamente\n" +
      "• Los audios se transcriben antes de procesar"
  );
};
