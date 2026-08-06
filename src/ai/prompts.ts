import {
  CategoryMap,
  ConversationContext,
  TransactionResult,
  ConversationMessage,
  ClarificationQuestion,
  MONEDA_OPTIONS,
  INGRESO_CATEGORIAS,
} from "../types";
import { extractTextWithoutEmoji } from "../utils/text";

function formatNumberedOptions(options: readonly string[]): string {
  return options.map((opt, i) => `${i + 1}: ${opt}`).join(", ");
}

function buildCategoriasText(categoriasMap: CategoryMap): string {
  const macroKeys = Object.keys(categoriasMap);
  let text = "📋 CATEGORÍAS (respondé con NÚMEROS):\n\n";
  text += `MACRO-CATEGORÍAS: ${formatNumberedOptions(macroKeys)}\n\n`;
  text += "SUBCATEGORÍAS por macro:\n";
  macroKeys.forEach((macro, i) => {
    const subs = categoriasMap[macro].map((s) => extractTextWithoutEmoji(s));
    text += `  Si macro=${i + 1} (${macro}): ${formatNumberedOptions(subs)}\n`;
  });
  return text;
}

export class PromptBuilder {
  static buildVisionPrompt(
    caption: string,
    categoriasMap: CategoryMap
  ): string {
    const descripcionCategorias = buildCategoriasText(categoriasMap);
    const monedaNumerada = formatNumberedOptions(MONEDA_OPTIONS);

    return `Analizá esta imagen de comprobante y extraé todos los gastos. Puede haber uno o varios ítems.
${caption ? `Contexto del usuario: "${caption}"` : ""}
Fecha de hoy (solo para referencia): ${new Date().toLocaleDateString("es-AR")}

${descripcionCategorias}

💰 MONEDA: ${monedaNumerada}

⚠️ REGLAS CRÍTICAS:
1. macro_categoria, subcategoria, moneda DEBEN ser NÚMEROS ENTEROS. NUNCA uses null, strings, ni texto. Si no estás seguro, usá 1 como default.
2. ⚠️ FECHA: Usá SIEMPRE la fecha del comprobante, NO la fecha de hoy.
3. mi_parte: número entre 0 y 100 que representa el porcentaje del gasto que corresponde al usuario. Default 100 si no se menciona división.
4. Si el comprobante tiene múltiples ítems con precios distintos, creá un objeto por cada ítem. Si tiene solo un total, creá uno solo con el total.

📋 EJEMPLO (ticket con total único):
{
  "gastos": [
    {
      "tipo": "GASTO",
      "datos": { "fecha": "07/01/2026", "descripcion": "Supermercado Carrefour", "macro_categoria": 1, "subcategoria": 1, "monto": 15000, "moneda": 1, "cuotas": 1, "n_cuota": 1, "mi_parte": 100, "notas": "Ticket #12345" },
      "confianza": "ALTA",
      "campos_faltantes": [],
      "razonamiento": "Compra en supermercado"
    }
  ]
}

📋 EJEMPLO (factura con ítems separados):
{
  "gastos": [
    { "tipo": "GASTO", "datos": { "fecha": "07/01/2026", "descripcion": "Café con leche", "macro_categoria": 1, "subcategoria": 3, "monto": 1800, "moneda": 1, "cuotas": 1, "n_cuota": 1, "mi_parte": 100, "notas": "" }, "confianza": "ALTA", "campos_faltantes": [] },
    { "tipo": "GASTO", "datos": { "fecha": "07/01/2026", "descripcion": "Medialunas x3", "macro_categoria": 1, "subcategoria": 3, "monto": 1200, "moneda": 1, "cuotas": 1, "n_cuota": 1, "mi_parte": 100, "notas": "" }, "confianza": "ALTA", "campos_faltantes": [] }
  ]
}

Respondé SOLO con JSON válido (sin markdown):
{
  "gastos": [
    {
      "tipo": "GASTO",
      "datos": {
        "fecha": "DD/MM/YYYY (del comprobante, NO de hoy)",
        "descripcion": "texto",
        "macro_categoria": INTEGER,
        "subcategoria": INTEGER,
        "monto": NUMBER,
        "moneda": INTEGER (1=ARS, 2=USD),
        "cuotas": INTEGER,
        "n_cuota": INTEGER,
        "mi_parte": NUMBER (0-100, default 100),
        "notas": "texto"
      },
      "confianza": "ALTA" | "MEDIA" | "BAJA",
      "campos_faltantes": [],
      "razonamiento": "texto corto"
    }
  ]
}

REGLAS:
- Fecha: SIEMPRE la del comprobante, NUNCA usar fecha de hoy
- Monto: sin separadores de miles, punto decimal (1234.56)
- Si no hay cuotas: cuotas=1, n_cuota=1
- mi_parte: si el usuario menciona división (ej: "50/50", "compartido", "mitad"), ajustá el porcentaje
- Si hay múltiples ítems con precios, generá un objeto por cada uno`;
  }

  static buildTextPrompt(
    text: string,
    categoriasMap: CategoryMap,
    contextoPrevio: ConversationContext | null,
    operacionPendiente: TransactionResult | null = null
  ): string {
    const descripcionCategorias = buildCategoriasText(categoriasMap);
    const monedaNumerada = formatNumberedOptions(MONEDA_OPTIONS);
    const categoriasIngresoNumeradas = formatNumberedOptions(INGRESO_CATEGORIAS);

    let contextoTexto = "";

    if (operacionPendiente) {
      const op = operacionPendiente;
      const d = op.datos;
      const categoriaTexto =
        op.tipo === "INGRESO"
          ? d.categoria || "(pendiente)"
          : `${d.macro_categoria || "(pendiente)"} → ${d.subcategoria || "(pendiente)"}`;
      contextoTexto =
        `\n\n⚠️ OPERACIÓN PENDIENTE DE CONFIRMACIÓN:\n` +
        `Hay un ${op.tipo} pendiente que el usuario aún NO ha confirmado:\n` +
        `- Descripción: ${d.descripcion || "(pendiente)"}\n` +
        `- Monto: $${d.monto || 0} ${d.moneda || "ARS"}\n` +
        `- Fecha: ${d.fecha || "Hoy"}\n` +
        `- Categoría: ${categoriaTexto}\n` +
        (op.tipo === "GASTO" ? `- Mi parte: ${d.mi_parte !== undefined ? d.mi_parte : 100}%\n` : "") +
        `\n🎯 IMPORTANTE: El usuario está MODIFICANDO esta operación pendiente. ` +
        `MANTENÉ todos los campos que el usuario NO menciona. ` +
        `Si el mensaje es claramente una NUEVA transacción, ignorá esta operación pendiente.`;
    } else if (contextoPrevio) {
      const d = contextoPrevio.datos;
      const categoriaTexto =
        contextoPrevio.tipo === "INGRESO"
          ? d.categoria
          : `${d.macro_categoria} → ${d.subcategoria}`;
      contextoTexto =
        `\n\n📋 CONTEXTO DE LA CONVERSACIÓN ANTERIOR:\n` +
        `El usuario acaba de confirmar un ${contextoPrevio.tipo}:\n` +
        `- Descripción: ${d.descripcion}\n` +
        `- Monto: $${d.monto} ${d.moneda || "ARS"}\n` +
        `- Fecha: ${d.fecha || "Hoy"}\n` +
        `- Categoría: ${categoriaTexto}\n` +
        `\nEl usuario puede estar haciendo referencia a este registro anterior. ` +
        `Si el mensaje es claramente una NUEVA transacción, ignorá el contexto.`;
    }

    return `Extraé todas las transacciones del mensaje (gastos y/o ingresos). Puede haber una o varias. Respondé SOLO con JSON válido.

Usuario dice: "${text}"
Fecha de hoy (solo para referencia): ${new Date().toLocaleDateString("es-AR")}

${descripcionCategorias}

💰 MONEDA: ${monedaNumerada}

💵 CATEGORÍAS DE INGRESO (respondé con NÚMERO, solo si tipo=INGRESO): ${categoriasIngresoNumeradas}
${contextoTexto}

⚠️ REGLAS CRÍTICAS:
1. tipo debe ser "GASTO" o "INGRESO". Usá INGRESO si el usuario cobró, recibió o ganó dinero (ej: "cobré el sueldo", "me pagaron un freelance", "recibí un reembolso", "me transfirieron", "vendí algo"). Usá GASTO para compras, pagos y gastos en general.
2. Si tipo=GASTO: completá macro_categoria, subcategoria, cuotas, n_cuota, mi_parte (NÚMEROS ENTEROS salvo mi_parte). NO incluyas categoria.
3. Si tipo=INGRESO: completá categoria (NÚMERO ENTERO, ver lista de categorías de ingreso). NO incluyas macro_categoria, subcategoria, cuotas, n_cuota, mi_parte.
4. moneda SIEMPRE debe ser NÚMERO ENTERO.
5. ⚠️ FECHA: Si el usuario menciona "hoy", "ayer", calculá la fecha real. Si no menciona fecha, dejá el campo vacío "".
6. Si el mensaje menciona múltiples ítems, precios, o mezcla gastos e ingresos, creá un objeto por cada transacción.

📋 EJEMPLO (un gasto):
{
  "gastos": [
    {
      "tipo": "GASTO",
      "datos": { "fecha": "10/01/2026", "descripcion": "Almuerzo", "macro_categoria": 1, "subcategoria": 2, "monto": 5000, "moneda": 1, "cuotas": 1, "n_cuota": 1, "mi_parte": 50, "notas": "" },
      "usa_contexto": false
    }
  ]
}

📋 EJEMPLO (un ingreso):
{
  "gastos": [
    {
      "tipo": "INGRESO",
      "datos": { "fecha": "10/01/2026", "descripcion": "Sueldo agosto", "categoria": 1, "monto": 500000, "moneda": 1, "notas": "" },
      "usa_contexto": false
    }
  ]
}

📋 EJEMPLO (ingreso y gasto en el mismo mensaje):
{
  "gastos": [
    { "tipo": "INGRESO", "datos": { "descripcion": "Freelance cliente X", "categoria": 2, "monto": 100000, "moneda": 1, "notas": "" } },
    { "tipo": "GASTO", "datos": { "descripcion": "Supermercado", "macro_categoria": 1, "subcategoria": 1, "monto": 15000, "moneda": 1, "cuotas": 1, "n_cuota": 1, "mi_parte": 100, "notas": "" } }
  ]
}

Respondé SOLO con JSON (sin markdown):
{
  "gastos": [
    {
      "tipo": "GASTO" | "INGRESO",
      "datos": {
        "fecha": "DD/MM/YYYY" o "",
        "descripcion": "texto",
        "macro_categoria": INTEGER (solo si tipo=GASTO),
        "subcategoria": INTEGER (solo si tipo=GASTO),
        "categoria": INTEGER (solo si tipo=INGRESO),
        "monto": NUMBER,
        "moneda": INTEGER (1=ARS, 2=USD),
        "cuotas": INTEGER (solo si tipo=GASTO),
        "n_cuota": INTEGER (solo si tipo=GASTO),
        "mi_parte": NUMBER (solo si tipo=GASTO, 0-100),
        "notas": ""
      },
      "usa_contexto": true/false
    }
  ]
}

REGLAS:
- Si hay OPERACIÓN PENDIENTE, el usuario la está modificando. Mantené campos no mencionados.
- Fecha: "hoy" → fecha de hoy, "ayer" → resta 1 día, sin fecha → ""
- mi_parte (solo GASTO): si menciona "compartido", "50/50", "mitad" → 50. Si menciona un porcentaje → usalo. Default 100.
- Si el mensaje tiene múltiples precios/ítems o mezcla gastos e ingresos, generá un objeto por cada uno en el array gastos.`;
  }

  static buildConversationalPrompt(
    messages: ConversationMessage[],
    currentInput: string,
    categoriasMap: CategoryMap,
    pendingQuestions?: ClarificationQuestion[],
    partialTransaction?: Partial<TransactionResult>
  ): string {
    const descripcionCategorias = buildCategoriasText(categoriasMap);
    const monedaNumerada = formatNumberedOptions(MONEDA_OPTIONS);

    const historyText =
      messages.length > 0
        ? messages
            .slice(-10)
            .map((m) => `[${m.role.toUpperCase()}]: ${m.content}`)
            .join("\n")
        : "(Sin historial previo)";

    let pendingQuestionsText = "";
    if (pendingQuestions && pendingQuestions.length > 0) {
      pendingQuestionsText =
        "\n\n⚠️ PREGUNTAS PENDIENTES QUE EL USUARIO PODRÍA ESTAR RESPONDIENDO:\n" +
        pendingQuestions.map((q) => `- ${q.field}: "${q.questionText}"`).join("\n") +
        "\n\nSi el mensaje del usuario parece responder alguna de estas preguntas, integrá la respuesta.";
    }

    let partialTransactionText = "";
    if (partialTransaction) {
      partialTransactionText =
        "\n\n📝 TRANSACCIÓN EN CONSTRUCCIÓN:\n" +
        `Datos parciales: ${JSON.stringify(partialTransaction.datos || {}, null, 2)}\n` +
        "\nIntegrá la nueva información del usuario con estos datos.";
    }

    return `Sos un asistente financiero conversacional. Tu objetivo es ayudar al usuario a registrar gastos.

HISTORIAL DE CONVERSACIÓN:
${historyText}

MENSAJE ACTUAL DEL USUARIO: "${currentInput}"
Fecha de hoy: ${new Date().toLocaleDateString("es-AR")}

${descripcionCategorias}

💰 MONEDA: ${monedaNumerada}
${pendingQuestionsText}
${partialTransactionText}

📋 INSTRUCCIONES DE RESPUESTA:

Respondé con JSON en UNO de estos formatos:

FORMATO 1 - Transacción completa:
{
  "responseType": "transaction",
  "transaction": {
    "tipo": "GASTO",
    "datos": {
      "fecha": "DD/MM/YYYY",
      "descripcion": "texto",
      "macro_categoria": INTEGER,
      "subcategoria": INTEGER,
      "monto": NUMBER,
      "moneda": INTEGER,
      "cuotas": 1,
      "n_cuota": 1,
      "mi_parte": NUMBER (0-100)
    },
    "confianza": "ALTA"
  }
}

FORMATO 2 - Necesitás clarificación:
{
  "responseType": "clarification",
  "partialTransaction": {
    "tipo": "GASTO",
    "datos": { /* campos identificados */ }
  },
  "message": "Entendido! [resumen]. Necesito algunos datos:",
  "questions": [
    {
      "field": "monto",
      "questionText": "¿Cuál fue el monto?",
      "questionType": "text",
      "confidence": "BAJA"
    }
  ]
}

FORMATO 3 - Error:
{
  "responseType": "error",
  "errorMessage": "No pude entender tu mensaje",
  "suggestions": ["Intenta decir 'Gasté 500 en supermercado'"]
}

🎯 REGLAS:
1. Pedí clarificación si falta el MONTO o si la categoría es muy ambigua.
2. Máximo 3 preguntas por respuesta.
3. macro_categoria, subcategoria, moneda DEBEN ser INTEGERS.
4. mi_parte: default 100, ajustá si mencionan división.
5. El campo "message" debe ser en español rioplatense.

Respondé SOLO con JSON válido (sin markdown):`;
  }
}
