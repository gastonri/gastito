// --- CONFIGURACIÓN INICIAL ---
const TELEGRAM_TOKEN = "TELEGRAM_TOKEN";
const GEMINI_API_KEY = "GEMINI_API_KEY";
const WEBHOOK_URL = "WEBHOOK_URL";
const MODEL_NAME = "gemini-2.5-flash"; // Modelo estable con visión y audio - Free Tier
const MI_CHAT_ID = 0; // YOUR_CHAT_ID

// ============================================================
// PUNTO DE ENTRADA - doPost()
// ============================================================
function doPost(e) {
  const contents = JSON.parse(e.postData.contents);
  
  // 1. MANEJO DE BOTONES (cuando el usuario clickea Confirmar/Cancelar)
  if (contents.callback_query) {
    handleCallback(contents.callback_query);
    return;
  }

  // 2. VALIDACIÓN DE SEGURIDAD
  const chatId = contents.message.chat.id;
  if (chatId !== MI_CHAT_ID) {
    Logger.log("Intento de acceso no autorizado de: " + chatId);
    sendTelegramMsg(chatId, "⛔ No tenés permiso para usar este bot.");
    return;
  }

  try {
    // 3. DETERMINAR TIPO DE MENSAJE
    const message = contents.message;
    
    // ✅ NUEVO: Manejar comandos
    if (message.text && (message.text.startsWith("/nuevo") || message.text.startsWith("/reset"))) {
      const props = PropertiesService.getScriptProperties();
      props.deleteProperty(`last_context_${chatId}`);
      sendTelegramMsg(chatId, "🔄 *Contexto limpiado*\n\nEmpezando conversación nueva.");
      return;
    }
    
    if (message.text && message.text.startsWith("/contexto")) {
      const contextoPrevio = obtenerContextoPrevio(chatId);
      if (contextoPrevio) {
        sendTelegramMsg(chatId, `📋 *Último registro confirmado:*\n\n${generarResumen(contextoPrevio)}`);
      } else {
        sendTelegramMsg(chatId, "📋 No hay contexto previo. Empezá una nueva conversación.");
      }
      return;
    }
    
    let result;
    let loadingMessageId = null;
    
    if (message.photo) {
      // 📸 MENSAJE CON IMAGEN - DEBUG MODE
      loadingMessageId = sendTelegramMsg(chatId, "📸 Paso 1/5: Iniciando análisis...");
      
      try {
        // Checkpoint 1: Descargar imagen
        actualizarMensaje(chatId, loadingMessageId, "📸 Paso 2/5: Descargando imagen de Telegram...");
        const photo = message.photo[message.photo.length - 1];
        const imageData = descargarImagenTelegram(photo.file_id);
        
        // Checkpoint 2: Preparar contexto
        actualizarMensaje(chatId, loadingMessageId, "📸 Paso 3/5: Preparando contexto...");
        const ss = SpreadsheetApp.getActiveSpreadsheet();
        const config = ss.getSheetByName("CONFIG");
        
        // ✅ ACTUALIZADO: Nuevos rangos según diseño minimalista (con emojis en subcategorías)
        const lastRowConfig = config.getLastRow();
        const cuentas = config.getRange("A2:A" + lastRowConfig).getValues().flat().filter(String);
        const macroCategorias = config.getRange("B2:B" + lastRowConfig).getValues().flat().filter(String);
        const subcategorias = config.getRange("C2:C" + lastRowConfig).getValues().flat().filter(String);
        
        // Crear mapa de macro → subs
        const categoriasMap = crearMapaCategorias(config);
        
        const misDatos = obtenerDatosPersonales();
        
        // Checkpoint 3: Llamar a Gemini Vision
        actualizarMensaje(chatId, loadingMessageId, "📸 Paso 4/5: Analizando con IA (esto puede tardar)...");
        const caption = message.caption || "";
        const prompt = construirPromptVision(caption, cuentas, macroCategorias, subcategorias, categoriasMap, misDatos);
        
        Logger.log("Iniciando llamada a Gemini Vision...");
        let response;
        try {
          response = callGeminiVision(prompt, imageData);
          Logger.log(`Respuesta recibida de Gemini (${response.length} caracteres)`);
        } catch (visionError) {
          Logger.log(`Error en callGeminiVision: ${visionError.message}\nStack: ${visionError.stack}`);
          throw new Error(`Error al analizar imagen con IA: ${visionError.message}`);
        }
        
        // Checkpoint 4: Parsear respuesta
        actualizarMensaje(chatId, loadingMessageId, "📸 Paso 5/5: Procesando resultados...");
        
        let cleanedResponse = response.replace(/```json|```/g, "").trim();
        Logger.log(`Respuesta limpia para parsear (${cleanedResponse.length} caracteres): ${cleanedResponse.substring(0, 200)}...`);
        
        try {
          result = JSON.parse(cleanedResponse);
        } catch (parseError) {
          Logger.log(`Error parseando JSON: ${parseError.message}\nRespuesta: ${cleanedResponse}`);
          throw new Error(`Error al procesar respuesta de IA. La respuesta no es JSON válido: ${parseError.message}\n\nRespuesta recibida: ${cleanedResponse.substring(0, 500)}`);
        }
        
        // Agregar alertas si es necesario
        if (result.confianza === "BAJA" || result.campos_faltantes.length > 0) {
          result.alerta = `⚠️ Confianza ${result.confianza}. Campos dudosos: ${result.campos_faltantes.join(", ")}`;
        }
        if (result.razonamiento) {
          result.alerta = (result.alerta || "") + `\n\n💡 ${result.razonamiento}`;
        }
        
      } catch (imgError) {
        actualizarMensaje(chatId, loadingMessageId, 
          `❌ Error en procesamiento de imagen:\n${imgError.message}\n\nStack: ${imgError.stack}`);
        Logger.log("Error detallado: " + JSON.stringify(imgError));
        return;
      }
      
    } else if (message.voice || message.audio) {
      // 🎤 MENSAJE DE AUDIO
      loadingMessageId = sendTelegramMsg(chatId, "🎤 Paso 1/4: Transcribiendo audio...");
      
      try {
        // Descargar audio
        actualizarMensaje(chatId, loadingMessageId, "🎤 Paso 2/4: Descargando audio de Telegram...");
        const audioFile = message.voice || message.audio;
        
        // Validar tamaño del archivo (máximo 20MB para evitar problemas)
        const maxFileSize = 20 * 1024 * 1024; // 20MB en bytes
        if (audioFile.file_size && audioFile.file_size > maxFileSize) {
          throw new Error(`El archivo de audio es demasiado grande (${Math.round(audioFile.file_size / 1024 / 1024)}MB). Máximo permitido: 20MB`);
        }
        
        const audioData = descargarAudioTelegram(audioFile.file_id);
        
        // Transcribir con Gemini
        actualizarMensaje(chatId, loadingMessageId, "🎤 Paso 3/4: Transcribiendo con IA (esto puede tardar)...");
        const textoTranscrito = callGeminiAudio(audioData);
        
        Logger.log(`Texto transcrito: ${textoTranscrito}`);
        
        if (!textoTranscrito || textoTranscrito.trim() === "") {
          throw new Error("No se pudo transcribir el audio. Asegurate de que el audio sea claro y esté en español.");
        }
        
        // Mostrar transcripción antes de procesar
        const contextoPrevio = obtenerContextoPrevio(chatId);
        actualizarMensaje(chatId, loadingMessageId, 
          `🎤 *Transcripción:*\n\n"${textoTranscrito}"\n\n` +
          `Procesando...`);
        
        // Procesar el texto transcrito como si fuera un mensaje de texto
        result = procesarConIA(textoTranscrito, contextoPrevio);
        
      } catch (audioError) {
        actualizarMensaje(chatId, loadingMessageId, 
          `❌ Error en procesamiento de audio:\n${audioError.message}\n\nStack: ${audioError.stack}`);
        Logger.log("Error detallado: " + JSON.stringify(audioError));
        return;
      }
      
    } else if (message.text) {
      // 💬 MENSAJE DE TEXTO
      const contextoPrevio = obtenerContextoPrevio(chatId);
      loadingMessageId = sendTelegramMsg(chatId, "💬 Procesando...");
      result = procesarConIA(message.text, contextoPrevio);
      
    } else {
      sendTelegramMsg(chatId, "❌ Solo puedo procesar texto, imágenes de comprobantes o audios.");
      return;
    }
    
    // 4. Agregar indicador si está usando contexto
    if (result.usa_contexto) {
      result.alerta = (result.alerta || "") + `\n\n💭 *Usando contexto del último registro confirmado*`;
    }
    
    // 5. ENVIAR CONFIRMACIÓN (editando el mensaje de loading si existe)
    if (loadingMessageId) {
      enviarConfirmacionEditando(chatId, loadingMessageId, result);
    } else {
      enviarConfirmacion(chatId, result);
    }
    
  } catch (err) {
    Logger.log("Error completo: " + err.stack);
    sendTelegramMsg(chatId, "❌ Error general: " + err.message + "\n\nStack: " + err.stack);
  }
}

// ============================================================
// CREAR MAPA DE CATEGORÍAS (Macro → Subcategorías)
// ============================================================
function crearMapaCategorias(configSheet) {
  // Usar rango dinámico para leer todas las categorías disponibles
  const lastRow = configSheet.getLastRow();
  const datos = configSheet.getRange("B2:C" + lastRow).getValues();
  const mapa = {};
  
  datos.forEach(function(row) {
    const macro = row[0];
    const sub = row[1];
    if (macro && sub) {
      if (!mapa[macro]) {
        mapa[macro] = [];
      }
      // Guardar la subcategoría completa con emoji para usar en validaciones
      mapa[macro].push(sub);
    }
  });
  
  return mapa;
}

// Función auxiliar para extraer texto sin emoji (para comparaciones)
function extraerTextoSinEmoji(texto) {
  if (!texto) return "";
  // Remover emojis y caracteres especiales, mantener solo texto
  return texto.replace(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu, "").trim();
}

// Función para encontrar subcategoría con emoji basada en texto sin emoji
function encontrarSubcategoriaConEmoji(subcategoriaSinEmoji, configSheet) {
  if (!subcategoriaSinEmoji) return "";
  
  const lastRow = configSheet.getLastRow();
  const datos = configSheet.getRange("C2:C" + lastRow).getValues().flat();
  
  // Buscar coincidencia exacta primero
  for (let i = 0; i < datos.length; i++) {
    const subcatConEmoji = datos[i];
    if (!subcatConEmoji) continue;
    
    const textoLimpio = extraerTextoSinEmoji(subcatConEmoji);
    if (textoLimpio.toLowerCase() === subcategoriaSinEmoji.toLowerCase()) {
      return subcatConEmoji;
    }
  }
  
  // Si no encuentra coincidencia exacta, buscar parcial
  for (let i = 0; i < datos.length; i++) {
    const subcatConEmoji = datos[i];
    if (!subcatConEmoji) continue;
    
    const textoLimpio = extraerTextoSinEmoji(subcatConEmoji);
    if (textoLimpio.toLowerCase().includes(subcategoriaSinEmoji.toLowerCase()) ||
        subcategoriaSinEmoji.toLowerCase().includes(textoLimpio.toLowerCase())) {
      return subcatConEmoji;
    }
  }
  
  // Si no encuentra nada, devolver el original
  return subcategoriaSinEmoji;
}

// ============================================================
// PROCESAMIENTO DE IMÁGENES CON GEMINI VISION
// ============================================================
function construirPromptVision(caption, cuentas, macroCategorias, subcategorias, categoriasMap, misDatos) {
  // Crear descripción del mapa de categorías para el prompt
  let descripcionCategorias = "📋 ESTRUCTURA DE CATEGORÍAS:\n";
  for (const macro in categoriasMap) {
    descripcionCategorias += `\n${macro}:\n`;
    categoriasMap[macro].forEach(function(sub) {
      descripcionCategorias += `  • ${sub}\n`;
    });
  }
  
  return `Sos un experto en leer comprobantes de pago argentinos. 
  Analizá esta imagen y extraé TODOS los datos del ticket/factura/comprobante.
  ${caption ? `Contexto adicional del usuario: "${caption}"` : ''}
  Fecha actual: ${new Date().toLocaleDateString('es-AR')}
  
  Cuentas válidas: ${cuentas.join(", ")}
  
  ${descripcionCategorias}
  
  🔑 DATOS DEL USUARIO (para identificar si es ingreso o egreso):
  - Nombre: ${misDatos.nombre}
  - Alias: ${misDatos.alias.join(", ")}
  ${misDatos.cbu ? `- CBU/CVU: ${misDatos.cbu}` : ''}
  ${misDatos.cuit ? `- CUIT/CUIL: ${misDatos.cuit}` : ''}
  
  Respondé ÚNICAMENTE un JSON (sin markdown) con:
  {
    "tipo": "GASTO" | "INGRESO" | "TRANSFERENCIA",
    "datos": {
      "fecha": "fecha del comprobante (formato DD/MM/YYYY)",
      "descripcion": "comercio o concepto (o nombre de quien transfiere si es ingreso)",
      "macro_categoria": "UNA de las macro-categorías disponibles (sin emoji)",
      "subcategoria": "subcategoría específica que corresponda a la macro",
      "cuenta": "cuenta usada (si está en el comprobante, sino inferila)",
      "monto": número sin símbolos,
      "moneda": "ARS" o "USD" o "EUR",
      "cuotas": número de cuotas si aplica,
      "n_cuota": número de cuota actual si aplica,
      "split": "Solo mío" o "Compartido 50/50" (solo para GASTO),
      "notas": "número de transacción, código, o info relevante",
      "fuente": "solo para INGRESO: de quién viene el dinero",
      "origen": "solo para TRANSFERENCIA: cuenta origen",
      "destino": "solo para TRANSFERENCIA: cuenta destino",
      "monto_salida": "solo para TRANSFERENCIA",
      "monto_entrada": "solo para TRANSFERENCIA"
    },
    "confianza": "ALTA" | "MEDIA" | "BAJA",
    "campos_faltantes": ["lista de campos que no pudiste identificar"],
    "razonamiento": "explicá brevemente por qué determinaste que es GASTO/INGRESO/TRANSFERENCIA"
  }
  
  🎯 REGLAS PARA DETERMINAR TIPO:
  
  **INGRESO** = El dinero ENTRA a mis cuentas:
  - Mi nombre/alias/CBU aparece como DESTINATARIO/RECEPTOR
  - El comprobante dice "Recibiste", "Te transfirieron", "Ingreso", "Acreditación"
  - Aparezco como vendedor en una factura
  - Ejemplos: transferencias recibidas, cobro de sueldo, reintegros, ventas
  
  **GASTO** = El dinero SALE de mis cuentas:
  - Mi nombre/alias/CBU aparece como ORIGEN/PAGADOR
  - El comprobante dice "Pagaste", "Compraste", "Débito", "Enviaste"
  - Tickets de compra en comercios
  - Facturas donde soy el cliente
  - Ejemplos: compras, pagos de servicios, transferencias enviadas
  
  **TRANSFERENCIA** = Movimiento entre MIS cuentas:
  - Tanto origen como destino son cuentas mías
  - Ej: de Mercado Pago a Banco
  
  ⚠️ Si NO podés determinar con certeza si es ingreso o gasto (ej: no aparece mi nombre en ningún lado), 
  asumí que es GASTO por defecto, pero poné confianza "MEDIA" o "BAJA".
  
  REGLAS CRÍTICAS DE FORMATO:
  - Si el monto tiene punto como separador de miles, eliminalo (ej: 1.500 → 1500)
  - Si tiene coma decimal, convertí a punto (ej: 1.234,56 → 1234.56)
  - La fecha debe ser la del comprobante, NO la de hoy
  - Para split: compras en supermercado/restaurante → "Compartido 50/50"
  - Para split: servicios personales/ropa/individual → "Solo mío"
  - Si no hay cuotas, poné 1 en ambos campos
  - Para INGRESO usa el campo "fuente" en lugar de "descripcion" para el concepto
  - IMPORTANTE: macro_categoria NO debe incluir emoji (ej: "ALIMENTACIÓN", no "🍽️ ALIMENTACIÓN")
  - La subcategoria debe corresponder a la macro_categoria elegida`;
}

function descargarImagenTelegram(fileId) {
  // 1. Obtener file_path de Telegram
  const getFileUrl = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/getFile?file_id=${fileId}`;
  const fileInfo = UrlFetchApp.fetch(getFileUrl);
  const filePath = JSON.parse(fileInfo.getContentText()).result.file_path;
  
  // 2. Descargar la imagen
  const downloadUrl = `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${filePath}`;
  const imageBlob = UrlFetchApp.fetch(downloadUrl).getBlob();
  
  // 3. Convertir a base64
  const base64Image = Utilities.base64Encode(imageBlob.getBytes());
  
  // 4. Detectar MIME type correcto desde la extensión del archivo
  let mimeType = "image/jpeg"; // Default
  
  if (filePath.toLowerCase().endsWith('.png')) {
    mimeType = "image/png";
  } else if (filePath.toLowerCase().endsWith('.jpg') || filePath.toLowerCase().endsWith('.jpeg')) {
    mimeType = "image/jpeg";
  } else if (filePath.toLowerCase().endsWith('.webp')) {
    mimeType = "image/webp";
  } else if (filePath.toLowerCase().endsWith('.gif')) {
    mimeType = "image/gif";
  }
  
  // Telegram comprime las fotos a JPEG casi siempre, así que si no detectamos nada, usamos JPEG
  Logger.log(`Archivo descargado: ${filePath} → MIME type detectado: ${mimeType}`);
  
  return {
    data: base64Image,
    mimeType: mimeType
  };
}

// ============================================================
// PROCESAMIENTO DE AUDIO CON GEMINI
// ============================================================
function descargarAudioTelegram(fileId) {
  // 1. Obtener file_path de Telegram
  const getFileUrl = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/getFile?file_id=${fileId}`;
  const fileInfo = UrlFetchApp.fetch(getFileUrl);
  const filePath = JSON.parse(fileInfo.getContentText()).result.file_path;
  
  // 2. Descargar el audio
  const downloadUrl = `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${filePath}`;
  const audioBlob = UrlFetchApp.fetch(downloadUrl).getBlob();
  
  // 3. Convertir a base64
  const base64Audio = Utilities.base64Encode(audioBlob.getBytes());
  
  // 4. Detectar MIME type desde la extensión
  let mimeType = "audio/ogg"; // Default para notas de voz de Telegram
  
  if (filePath.toLowerCase().endsWith('.ogg') || filePath.toLowerCase().endsWith('.oga')) {
    mimeType = "audio/ogg";
  } else if (filePath.toLowerCase().endsWith('.mp3')) {
    mimeType = "audio/mpeg";
  } else if (filePath.toLowerCase().endsWith('.m4a')) {
    mimeType = "audio/mp4";
  } else if (filePath.toLowerCase().endsWith('.wav')) {
    mimeType = "audio/wav";
  } else if (filePath.toLowerCase().endsWith('.flac')) {
    mimeType = "audio/flac";
  }
  
  Logger.log(`Audio descargado: ${filePath} → MIME type detectado: ${mimeType}`);
  
  return {
    data: base64Audio,
    mimeType: mimeType
  };
}

function callGeminiAudio(audioData) {
  const url = `https://generativelanguage.googleapis.com/v1/models/${MODEL_NAME}:generateContent?key=${GEMINI_API_KEY}`;
  
  const payload = {
    contents: [{
      parts: [
        {
          text: `Transcribí este audio al español. El usuario está describiendo un gasto, ingreso o transferencia financiera. 
          Transcribí TODO el contenido del audio de forma literal y completa, sin resumir ni interpretar.
          Si el audio está en otro idioma, traducilo al español primero y luego transcribilo.
          
          IMPORTANTE: 
          - El audio está en español (o debe traducirse al español)
          - Solo transcribí el texto, no agregues comentarios ni explicaciones adicionales
          - Mantené la transcripción exacta de lo que dice el usuario`
        },
        {
          inline_data: {
            mime_type: audioData.mimeType,
            data: audioData.data
          }
        }
      ]
    }]
  };
  
  const options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  Logger.log(`Llamando a Gemini Audio API con modelo: ${MODEL_NAME}`);
  const res = UrlFetchApp.fetch(url, options);
  const responseCode = res.getResponseCode();
  const responseText = res.getContentText();
  
  Logger.log(`Respuesta de Gemini Audio - Código: ${responseCode}`);
  
  let json;
  try {
    json = JSON.parse(responseText);
  } catch (parseError) {
    Logger.log(`Error parseando respuesta JSON: ${responseText}`);
    throw new Error(`Error parseando respuesta de Gemini: ${parseError.message}\nRespuesta: ${responseText.substring(0, 500)}`);
  }

  if (responseCode !== 200) {
    const errorMsg = json.error ? JSON.stringify(json.error) : responseText;
    Logger.log(`Error de Gemini API: ${errorMsg}`);
    throw new Error(`Gemini Audio Error (${responseCode}): ${errorMsg}`);
  }
  
  // Validar estructura de respuesta
  if (!json.candidates || json.candidates.length === 0) {
    Logger.log(`Respuesta sin candidates: ${JSON.stringify(json)}`);
    throw new Error(`Gemini Audio Error: La respuesta no contiene candidates.`);
  }
  
  if (!json.candidates[0].content || !json.candidates[0].content.parts || json.candidates[0].content.parts.length === 0) {
    Logger.log(`Respuesta con estructura inesperada: ${JSON.stringify(json.candidates[0])}`);
    throw new Error(`Gemini Audio Error: La respuesta tiene una estructura inesperada.`);
  }
  
  const text = json.candidates[0].content.parts[0].text;
  if (!text) {
    Logger.log(`Respuesta sin texto: ${JSON.stringify(json.candidates[0])}`);
    throw new Error(`Gemini Audio Error: La respuesta no contiene texto transcrito.`);
  }
  
  Logger.log(`Transcripción exitosa (${text.length} caracteres)`);
  return text.trim();
}

// ============================================================
// OBTENER CONTEXTO PREVIO DE CONVERSACIÓN
// ============================================================
function obtenerContextoPrevio(chatId) {
  const props = PropertiesService.getScriptProperties();
  const contextoJson = props.getProperty(`last_context_${chatId}`);
  
  if (!contextoJson) {
    return null;
  }
  
  try {
    return JSON.parse(contextoJson);
  } catch (e) {
    Logger.log("Error parseando contexto previo: " + e.message);
    return null;
  }
}

// ============================================================
// PROCESAMIENTO DE TEXTO CON GEMINI (con contexto de conversación)
// ============================================================
function procesarConIA(text, contextoPrevio = null) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const config = ss.getSheetByName("CONFIG");
  
  // ✅ ACTUALIZADO: Nuevos rangos según diseño minimalista (con emojis en subcategorías)
  const lastRowConfig = config.getLastRow();
  const cuentas = config.getRange("A2:A" + lastRowConfig).getValues().flat().filter(String);
  const macroCategorias = config.getRange("B2:B" + lastRowConfig).getValues().flat().filter(String);
  const subcategorias = config.getRange("C2:C" + lastRowConfig).getValues().flat().filter(String);
  const categoriasMap = crearMapaCategorias(config);
  
  // Crear descripción del mapa
  let descripcionCategorias = "Categorías disponibles:\n";
  for (const macro in categoriasMap) {
    descripcionCategorias += `${macro}: ${categoriasMap[macro].join(", ")}\n`;
  }

  // ✅ NUEVO: Construir contexto previo si existe
  let contextoTexto = "";
  if (contextoPrevio) {
    const ctx = contextoPrevio.datos;
    contextoTexto = `\n\n📋 CONTEXTO DE LA CONVERSACIÓN ANTERIOR:\n` +
      `El usuario acaba de confirmar un ${contextoPrevio.tipo}:\n` +
      (contextoPrevio.tipo === "GASTO" ? 
        `- Descripción: ${ctx.descripcion}\n` +
        `- Monto: $${ctx.monto} ${ctx.moneda || 'ARS'}\n` +
        `- Fecha: ${ctx.fecha || 'Hoy'}\n` +
        `- Cuenta: ${ctx.cuenta}\n` +
        `- Categoría: ${ctx.macro_categoria} → ${ctx.subcategoria}\n` +
        `- Split: ${ctx.split || 'Solo mío'}\n` :
      contextoPrevio.tipo === "INGRESO" ?
        `- Fuente: ${ctx.fuente || ctx.descripcion}\n` +
        `- Monto: $${ctx.monto} ${ctx.moneda || 'ARS'}\n` +
        `- Cuenta: ${ctx.cuenta}\n` :
        `- Origen: ${ctx.origen} → Destino: ${ctx.destino}\n` +
        `- Monto salida: $${ctx.monto_salida}\n` +
        `- Monto entrada: $${ctx.monto_entrada}\n`
      ) +
      `\nEl usuario puede estar haciendo referencia a este registro anterior. ` +
      `Si dice cosas como "era compartido", "cambia la fecha", "agrega esto también", ` +
      `interpretá el mensaje en contexto del registro anterior.\n` +
      `Si el mensaje es claramente un NUEVO gasto/ingreso/transferencia, ignorá el contexto y creá uno nuevo.`;
  }

  const prompt = `Actúa como un extractor de datos financieros. 
  Usuario dice: "${text}". Hoy es ${new Date().toLocaleDateString('es-AR')}.
  
  Cuentas disponibles: ${cuentas.join(", ")}
  
  ${descripcionCategorias}
  
  ${contextoTexto}
  
  Responde ÚNICAMENTE un JSON puro (sin markdown) con este formato:
  {
    "tipo": "GASTO" | "INGRESO" | "TRANSFERENCIA",
    "datos": {
      "fecha": "DD/MM/YYYY",
      "descripcion": "...",
      "macro_categoria": "sin emoji, ej: ALIMENTACIÓN",
      "subcategoria": "debe corresponder a la macro",
      "cuenta": "...",
      "monto": número,
      "cuotas": 1 si no aplica,
      "n_cuota": 1 si no aplica,
      "moneda": "ARS" | "USD" | "EUR",
      "split": "Solo mío" | "Compartido 50/50",
      "link": "",
      "notas": ""
    },
    "usa_contexto": true/false
  }
  
  Si es GASTO: Todos los campos arriba son requeridos.
  Si es INGRESO: usa {fecha, fuente, cuenta, monto, moneda, cotizacion}.
  Si es TRANSFERENCIA: usa {fecha, origen, destino, monto_salida, monto_entrada}.
  
  ⚠️ IMPORTANTE: Si el usuario está modificando el registro anterior (ej: "era compartido", "cambia la fecha a ayer"),
  devolvé los datos del registro anterior con las modificaciones solicitadas y poné "usa_contexto": true.`;

  const response = callGemini(prompt);
  const result = JSON.parse(response.replace(/```json|```/g, "").trim());
  
  // Asegurar que usa_contexto existe (por si Gemini no lo incluye)
  if (result.usa_contexto === undefined) {
    result.usa_contexto = contextoPrevio !== null;
  }
  
  return result;
}

// ============================================================
// OBTENER DATOS PERSONALES PARA IDENTIFICACIÓN
// ============================================================
function obtenerDatosPersonales() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // Intentar leer de una pestaña "MIS_DATOS" (si existe)
  let sheet = ss.getSheetByName("MIS_DATOS");
  
  if (!sheet) {
    // Si no existe, usar valores por defecto (el usuario los debe configurar)
    Logger.log("⚠️ No existe la pestaña MIS_DATOS. Usando valores por defecto.");
    return {
      nombre: "TU NOMBRE COMPLETO", // REEMPLAZÁ ESTO
      alias: ["tu.alias.mp", "tu.cvu"], // REEMPLAZÁ ESTO
      cbu: "", // Opcional
      cuit: "" // Opcional
    };
  }
  
  // Leer datos de la pestaña MIS_DATOS (estructura esperada en la documentación abajo)
  const datos = {
    nombre: sheet.getRange("B2").getValue() || "Usuario",
    alias: sheet.getRange("B3").getValue().split(",").map(function(a) { return a.trim(); }).filter(String),
    cbu: sheet.getRange("B4").getValue() || "",
    cuit: sheet.getRange("B5").getValue() || ""
  };
  
  return datos;
}

// ============================================================
// ENVIAR MENSAJE DE CONFIRMACIÓN CON BOTONES
// ============================================================
function enviarConfirmacion(chatId, data) {
  const operationId = Utilities.getUuid();
  
  // Guardar datos temporalmente
  const props = PropertiesService.getScriptProperties();
  props.setProperty(operationId, JSON.stringify(data));
  
  // Crear botones inline
  const keyboard = {
    inline_keyboard: [[
      { text: "✅ Confirmar", callback_data: "conf_" + operationId },
      { text: "🗑️ Cancelar", callback_data: "cancel_" + operationId }
    ]]
  };

  const mensaje = construirMensajeConfirmacion(data);
  sendTelegramMsg(chatId, mensaje, keyboard);
}

// NUEVA: Editar mensaje existente con la confirmación
function enviarConfirmacionEditando(chatId, messageId, data) {
  const operationId = Utilities.getUuid();
  
  // Guardar datos temporalmente
  const props = PropertiesService.getScriptProperties();
  props.setProperty(operationId, JSON.stringify(data));
  
  // Crear botones inline
  const keyboard = {
    inline_keyboard: [[
      { text: "✅ Confirmar", callback_data: "conf_" + operationId },
      { text: "🗑️ Cancelar", callback_data: "cancel_" + operationId }
    ]]
  };

  const mensaje = construirMensajeConfirmacion(data);
  
  // Editar el mensaje de "Analizando..." con el resultado
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/editMessageText`;
  const payload = {
    chat_id: chatId.toString(),
    message_id: messageId,
    text: mensaje,
    parse_mode: "Markdown",
    reply_markup: JSON.stringify(keyboard)
  };
  
  const options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };
  
  UrlFetchApp.fetch(url, options);
}

// Construir el mensaje de confirmación (extraído para reutilizar)
function construirMensajeConfirmacion(data) {
  let mensaje = "";
  const d = data.datos;
  
  // Mostrar alerta de confianza si existe
  const alertaConfianza = data.alerta ? `\n\n${data.alerta}` : "";
  
  if (data.tipo === "GASTO") {
    mensaje = `🤔 *¿Confirmás este gasto?*\n\n` +
              `📝 *Descripción:* ${d.descripcion}\n` +
              `💵 *Monto:* $${d.monto} ${d.moneda || 'ARS'}\n` +
              `📅 *Fecha:* ${d.fecha || 'Hoy'}\n` +
              `🏦 *Cuenta:* ${d.cuenta}\n` +
              `🏷️ *Categoría:* ${d.macro_categoria}\n` +
              `🔖 *Subcategoría:* ${d.subcategoria}\n` +
              `🔄 *Split:* ${d.split || 'Solo mío'}` +
              (d.cuotas > 1 ? `\n💳 *Cuotas:* ${d.cuotas} (cuota ${d.n_cuota || 1})` : '') +
              (d.notas ? `\n📋 *Notas:* ${d.notas}` : '') +
              alertaConfianza;
  } else if (data.tipo === "INGRESO") {
    mensaje = `🤔 *¿Confirmás este ingreso?*\n\n` +
              `💰 *Fuente:* ${d.fuente || d.descripcion}\n` +
              `💵 *Monto:* $${d.monto} ${d.moneda || 'ARS'}\n` +
              `📅 *Fecha:* ${d.fecha || 'Hoy'}\n` +
              `🏦 *Cuenta:* ${d.cuenta}` +
              (d.notas ? `\n📋 *Notas:* ${d.notas}` : '') +
              alertaConfianza;
  } else if (data.tipo === "TRANSFERENCIA") {
    mensaje = `🤔 *¿Confirmás esta transferencia?*\n\n` +
              `📤 *Origen:* ${d.origen} (-$${d.monto_salida})\n` +
              `📥 *Destino:* ${d.destino} (+$${d.monto_entrada})` +
              (d.comision ? `\n💸 *Comisión:* $${d.comision}` : '') +
              alertaConfianza;
  }

  return mensaje;
}

// ============================================================
// MANEJAR CLICK EN BOTONES
// ============================================================
function handleCallback(callback) {
  const chatId = callback.message.chat.id;
  const messageId = callback.message.message_id;
  const data = callback.data;

  if (chatId !== MI_CHAT_ID) {
    answerCallback(callback.id, "⛔ No autorizado");
    return;
  }

  if (data.startsWith("conf_")) {
    const operationId = data.replace("conf_", "");
    const props = PropertiesService.getScriptProperties();
    const storedData = props.getProperty(operationId);
    
    if (!storedData) {
      actualizarMensaje(chatId, messageId, "⏱️ Esta operación expiró. Enviá de nuevo el mensaje.");
      answerCallback(callback.id, "Operación expirada");
      return;
    }
    
    try {
      const jsonData = JSON.parse(storedData);
      Logger.log("Intentando escribir datos: " + JSON.stringify(jsonData));
      escribirEnSheet(jsonData);
      
      props.deleteProperty(operationId);
      
      // ✅ NUEVO: Guardar contexto del último mensaje confirmado
      props.setProperty(`last_context_${chatId}`, JSON.stringify(jsonData));
      
      actualizarMensaje(chatId, messageId, "✅ *¡Anotado perfectamente!*\n\n" + 
                        generarResumen(jsonData));
      answerCallback(callback.id, "✓ Guardado");
    } catch (error) {
      Logger.log("ERROR al escribir en sheet desde callback: " + error.message + "\nStack: " + error.stack);
      actualizarMensaje(chatId, messageId, "❌ *Error al guardar*\n\n" + error.message + "\n\nRevisá los logs para más detalles.");
      answerCallback(callback.id, "Error: " + error.message);
    }
    
  } else if (data.startsWith("cancel_")) {
    const operationId = data.replace("cancel_", "");
    const props = PropertiesService.getScriptProperties();
    props.deleteProperty(operationId);
    
    actualizarMensaje(chatId, messageId, "🗑️ *Operación cancelada*\n\nNo se guardó nada.");
    answerCallback(callback.id, "Cancelado");
  }
}

// ============================================================
// ENCONTRAR ÚLTIMA FILA CON DATOS REALES
// ============================================================
function encontrarUltimaFilaConDatos(sheet) {
  // Usar getLastRow() pero verificar que realmente tenga datos
  // Si getLastRow() devuelve una fila muy alta (por fórmulas/validaciones),
  // buscamos hacia arriba en bloques grandes para ser eficiente
  const lastRowFromSheet = sheet.getLastRow();
  
  // Si getLastRow() es razonable (menos de 1000), verificar si tiene datos reales
  if (lastRowFromSheet <= 1000) {
    const value = sheet.getRange(lastRowFromSheet, 1).getValue();
    if (value !== "" && value !== null) {
      return lastRowFromSheet;
    }
  }
  
  // Si getLastRow() es muy alto o no tiene datos, buscar en bloques grandes
  // Leer bloques de 500 filas a la vez desde abajo hacia arriba
  let startRow = Math.min(lastRowFromSheet, 10000);
  let lastRow = 1; // Empezar desde el header
  
  while (startRow >= 2) {
    const endRow = Math.max(2, startRow - 499);
    const range = sheet.getRange(endRow, 1, startRow - endRow + 1, 1);
    const values = range.getValues();
    
    // Buscar desde el final del array hacia el inicio
    for (let i = values.length - 1; i >= 0; i--) {
      if (values[i][0] !== "" && values[i][0] !== null) {
        lastRow = endRow + i;
        return lastRow;
      }
    }
    
    startRow = endRow - 1;
  }
  
  return lastRow;
}

// ============================================================
// ESCRIBIR EN GOOGLE SHEETS
// ============================================================
function escribirEnSheet(result) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  try {
    if (result.tipo === "GASTO") {
      const sheet = ss.getSheetByName("GASTOS");
      if (!sheet) {
        Logger.log("ERROR: No se encontró la hoja 'GASTOS'. Hojas disponibles: " + ss.getSheets().map(s => s.getName()).join(", "));
        throw new Error("No se encontró la hoja 'GASTOS'. Verifica que exista.");
      }
      
      const d = result.datos;
      Logger.log("Escribiendo GASTO: " + JSON.stringify(d));
      
      // Validaciones de campos requeridos
      if (!d.descripcion || d.descripcion.trim() === "") {
        throw new Error("El campo 'descripcion' es requerido para un GASTO");
      }
      if (!d.monto || isNaN(d.monto) || d.monto <= 0) {
        throw new Error("El campo 'monto' debe ser un número positivo. Valor recibido: " + d.monto);
      }
      if (!d.cuenta || d.cuenta.trim() === "") {
        throw new Error("El campo 'cuenta' es requerido para un GASTO");
      }
      if (!d.macro_categoria || d.macro_categoria.trim() === "") {
        throw new Error("El campo 'macro_categoria' es requerido para un GASTO");
      }
      if (!d.subcategoria || d.subcategoria.trim() === "") {
        throw new Error("El campo 'subcategoria' es requerido para un GASTO");
      }
      
      // Validar y parsear fecha
      let fecha = d.fecha || new Date();
      if (typeof fecha === 'string') {
        const partes = fecha.split('/');
        if (partes.length === 3) {
          const dia = parseInt(partes[0], 10);
          const mes = parseInt(partes[1], 10);
          const año = parseInt(partes[2], 10);
          if (isNaN(dia) || isNaN(mes) || isNaN(año)) {
            throw new Error("Formato de fecha inválido. Esperado: DD/MM/YYYY. Recibido: " + fecha);
          }
          fecha = new Date(año, mes - 1, dia);
        } else {
          throw new Error("Formato de fecha inválido. Esperado: DD/MM/YYYY. Recibido: " + fecha);
        }
      }
      
      // Validar que la fecha esté en rango válido (2020 - hoy)
      const fechaMin = new Date(2020, 0, 1);
      const fechaMax = new Date();
      if (fecha < fechaMin || fecha > fechaMax) {
        throw new Error("La fecha debe estar entre 2020 y hoy. Fecha recibida: " + fecha.toLocaleDateString('es-AR'));
      }
      
      // Validar moneda
      const monedasValidas = ["ARS", "USD", "EUR"];
      const moneda = d.moneda || "ARS";
      if (monedasValidas.indexOf(moneda) === -1) {
        throw new Error("Moneda inválida. Valores permitidos: ARS, USD, EUR. Recibido: " + moneda);
      }
      
      // Validar cuotas
      const cuotas = parseInt(d.cuotas || 1, 10);
      const nCuota = parseInt(d.n_cuota || 1, 10);
      if (isNaN(cuotas) || cuotas < 1) {
        throw new Error("El número de cuotas debe ser mayor a 0. Recibido: " + d.cuotas);
      }
      if (isNaN(nCuota) || nCuota < 1 || nCuota > cuotas) {
        throw new Error("El número de cuota debe estar entre 1 y " + cuotas + ". Recibido: " + d.n_cuota);
      }
      
      // ✅ ACTUALIZADO: Nueva estructura con macro + sub + columnas desplazadas
      const ultimaFila = encontrarUltimaFilaConDatos(sheet);
      const nuevaFila = ultimaFila + 1;
      
      // Buscar subcategoría con emoji si viene sin emoji
      const config = ss.getSheetByName("CONFIG");
      const subcategoriaConEmoji = encontrarSubcategoriaConEmoji(d.subcategoria, config);
      
      sheet.getRange(nuevaFila, 1, 1, 14).setValues([[
        fecha,                           // A: FECHA
        d.descripcion.trim(),            // B: DESCRIPCIÓN
        d.macro_categoria.trim(),        // C: CATEGORIA
        subcategoriaConEmoji,            // D: SUBCATEGORÍA (con emoji)
        d.cuenta.trim(),                 // E: CUENTA
        parseFloat(d.monto),            // F: MONTO TOTAL
        cuotas,                          // G: CUOTAS
        nCuota,                          // H: N° CUOTA
        "",                              // I: IMP. MENSUAL (fórmula automática)
        moneda,                          // J: MONEDA
        d.split || "Solo mío",           // K: SPLIT?
        "",                              // L: A SPLITWISE (fórmula automática)
        (d.link || "").trim(),          // M: Link
        (d.notas || "").trim()           // N: Notas
      ]]);
      
      // Aplicar fórmulas automáticas en la nueva fila
      const rowNum = nuevaFila;
      sheet.getRange(rowNum, 9).setFormula('=IFERROR(IF(G' + rowNum + ' > 0; F' + rowNum + ' / G' + rowNum + '; F' + rowNum + '); "")');
      sheet.getRange(rowNum, 12).setFormula('=IFERROR(IF(EXACT(K' + rowNum + ';"Compartido 50/50"); I' + rowNum + '/2; ""); "")');
      
      Logger.log("✅ GASTO escrito exitosamente en fila " + rowNum);
      
    } else if (result.tipo === "INGRESO") {
      const sheet = ss.getSheetByName("INGRESOS");
      if (!sheet) {
        Logger.log("ERROR: No se encontró la hoja 'INGRESOS'. Hojas disponibles: " + ss.getSheets().map(s => s.getName()).join(", "));
        throw new Error("No se encontró la hoja 'INGRESOS'. Verifica que exista.");
      }
      
      const d = result.datos;
      Logger.log("Escribiendo INGRESO: " + JSON.stringify(d));
      
      // Validaciones de campos requeridos
      if (!d.fuente && !d.descripcion) {
        throw new Error("El campo 'fuente' o 'descripcion' es requerido para un INGRESO");
      }
      if (!d.monto || isNaN(d.monto) || d.monto <= 0) {
        throw new Error("El campo 'monto' debe ser un número positivo. Valor recibido: " + d.monto);
      }
      if (!d.cuenta || d.cuenta.trim() === "") {
        throw new Error("El campo 'cuenta' es requerido para un INGRESO");
      }
      
      // Validar y parsear fecha
      let fecha = d.fecha || new Date();
      if (typeof fecha === 'string') {
        const partes = fecha.split('/');
        if (partes.length === 3) {
          const dia = parseInt(partes[0], 10);
          const mes = parseInt(partes[1], 10);
          const año = parseInt(partes[2], 10);
          if (isNaN(dia) || isNaN(mes) || isNaN(año)) {
            throw new Error("Formato de fecha inválido. Esperado: DD/MM/YYYY. Recibido: " + fecha);
          }
          fecha = new Date(año, mes - 1, dia);
        } else {
          throw new Error("Formato de fecha inválido. Esperado: DD/MM/YYYY. Recibido: " + fecha);
        }
      }
      
      // Validar que la fecha esté en rango válido
      const fechaMinIng = new Date(2020, 0, 1);
      const fechaMaxIng = new Date();
      if (fecha < fechaMinIng || fecha > fechaMaxIng) {
        throw new Error("La fecha debe estar entre 2020 y hoy. Fecha recibida: " + fecha.toLocaleDateString('es-AR'));
      }
      
      // Validar moneda
      const monedasValidasIng = ["ARS", "USD", "EUR"];
      const monedaIng = d.moneda || "ARS";
      if (monedasValidasIng.indexOf(monedaIng) === -1) {
        throw new Error("Moneda inválida. Valores permitidos: ARS, USD, EUR. Recibido: " + monedaIng);
      }
      
      // Validar cotización si es necesario
      const cotizacion = parseFloat(d.cotizacion || 1);
      if (isNaN(cotizacion) || cotizacion <= 0) {
        throw new Error("La cotización debe ser un número positivo. Valor recibido: " + d.cotizacion);
      }
      
      const ultimaFilaIng = encontrarUltimaFilaConDatos(sheet);
      const nuevaFilaIng = ultimaFilaIng + 1;
      
      sheet.getRange(nuevaFilaIng, 1, 1, 7).setValues([[
        fecha,                           // A: FECHA
        (d.fuente || d.descripcion || "").trim(), // B: FUENTE
        d.cuenta.trim(),                 // C: CUENTA DESTINO
        parseFloat(d.monto),            // D: MONTO BRUTO
        monedaIng,                       // E: MONEDA
        cotizacion,                      // F: COTIZACIÓN
        ""                               // G: TOTAL (ARS) - fórmula automática
      ]]);
      
      // Aplicar fórmula automática en la nueva fila
      const rowNumIng = nuevaFilaIng;
      sheet.getRange(rowNumIng, 7).setFormula('=IFERROR(IF(E' + rowNumIng + '="USD"; D' + rowNumIng + '*F' + rowNumIng + '; IF(E' + rowNumIng + '="EUR"; D' + rowNumIng + '*F' + rowNumIng + '; D' + rowNumIng + ')); "")');
      
      Logger.log("✅ INGRESO escrito exitosamente en fila " + rowNumIng);
      
    } else if (result.tipo === "TRANSFERENCIA") {
      const sheet = ss.getSheetByName("TRANSFERENCIAS");
      if (!sheet) {
        Logger.log("ERROR: No se encontró la hoja 'TRANSFERENCIAS'. Hojas disponibles: " + ss.getSheets().map(s => s.getName()).join(", "));
        throw new Error("No se encontró la hoja 'TRANSFERENCIAS'. Verifica que exista.");
      }
      
      const d = result.datos;
      Logger.log("Escribiendo TRANSFERENCIA: " + JSON.stringify(d));
      
      // Validaciones de campos requeridos
      if (!d.origen || d.origen.trim() === "") {
        throw new Error("El campo 'origen' es requerido para una TRANSFERENCIA");
      }
      if (!d.destino || d.destino.trim() === "") {
        throw new Error("El campo 'destino' es requerido para una TRANSFERENCIA");
      }
      if (!d.monto_salida || isNaN(d.monto_salida) || d.monto_salida <= 0) {
        throw new Error("El campo 'monto_salida' debe ser un número positivo. Valor recibido: " + d.monto_salida);
      }
      if (!d.monto_entrada || isNaN(d.monto_entrada) || d.monto_entrada <= 0) {
        throw new Error("El campo 'monto_entrada' debe ser un número positivo. Valor recibido: " + d.monto_entrada);
      }
      
      // Validar y parsear fecha
      let fecha = d.fecha || new Date();
      if (typeof fecha === 'string') {
        const partes = fecha.split('/');
        if (partes.length === 3) {
          const dia = parseInt(partes[0], 10);
          const mes = parseInt(partes[1], 10);
          const año = parseInt(partes[2], 10);
          if (isNaN(dia) || isNaN(mes) || isNaN(año)) {
            throw new Error("Formato de fecha inválido. Esperado: DD/MM/YYYY. Recibido: " + fecha);
          }
          fecha = new Date(año, mes - 1, dia);
        } else {
          throw new Error("Formato de fecha inválido. Esperado: DD/MM/YYYY. Recibido: " + fecha);
        }
      }
      
      // Validar que la fecha esté en rango válido
      const fechaMinTrans = new Date(2020, 0, 1);
      const fechaMaxTrans = new Date();
      if (fecha < fechaMinTrans || fecha > fechaMaxTrans) {
        throw new Error("La fecha debe estar entre 2020 y hoy. Fecha recibida: " + fecha.toLocaleDateString('es-AR'));
      }
      
      const ultimaFilaTrans = encontrarUltimaFilaConDatos(sheet);
      const nuevaFilaTrans = ultimaFilaTrans + 1;
      
      sheet.getRange(nuevaFilaTrans, 1, 1, 6).setValues([[
        fecha,                           // A: FECHA
        d.origen.trim(),                 // B: ORIGEN
        parseFloat(d.monto_salida),     // C: MONTO SALIDA
        d.destino.trim(),                // D: DESTINO
        parseFloat(d.monto_entrada),    // E: MONTO ENTRADA
        ""                               // F: BRECHA % - fórmula automática
      ]]);
      
      // Aplicar fórmula automática en la nueva fila
      const rowNumTrans = nuevaFilaTrans;
      sheet.getRange(rowNumTrans, 6).setFormula('=IFERROR(IF(C' + rowNumTrans + '>0;((E' + rowNumTrans + '-C' + rowNumTrans + ')/C' + rowNumTrans + ')*100;"");"")');
      
      Logger.log("✅ TRANSFERENCIA escrita exitosamente en fila " + rowNumTrans);
    } else {
      Logger.log("ERROR: Tipo desconocido: " + result.tipo);
      throw new Error("Tipo de operación desconocido: " + result.tipo);
    }
  } catch (error) {
    Logger.log("ERROR al escribir en sheet: " + error.message + "\nStack: " + error.stack);
    throw error;
  }
}

// ============================================================
// LLAMADAS A GEMINI
// ============================================================
function callGemini(prompt) {
  const url = `https://generativelanguage.googleapis.com/v1/models/${MODEL_NAME}:generateContent?key=${GEMINI_API_KEY}`;
  const payload = {
    contents: [{ parts: [{ text: prompt }] }]
  };
  
  const options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  const res = UrlFetchApp.fetch(url, options);
  const json = JSON.parse(res.getContentText());

  if (res.getResponseCode() !== 200) {
    throw new Error(`Gemini API Error: ${json.error.message}`);
  }
  
  return json.candidates[0].content.parts[0].text;
}

function callGeminiVision(prompt, imageData) {
  const url = `https://generativelanguage.googleapis.com/v1/models/${MODEL_NAME}:generateContent?key=${GEMINI_API_KEY}`;
  
  const payload = {
    contents: [{
      parts: [
        { text: prompt },
        {
          inline_data: {
            mime_type: imageData.mimeType,
            data: imageData.data
          }
        }
      ]
    }]
  };
  
  const options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  Logger.log(`Llamando a Gemini Vision API con modelo: ${MODEL_NAME}`);
  const res = UrlFetchApp.fetch(url, options);
  const responseCode = res.getResponseCode();
  const responseText = res.getContentText();
  
  Logger.log(`Respuesta de Gemini - Código: ${responseCode}`);
  
  let json;
  try {
    json = JSON.parse(responseText);
  } catch (parseError) {
    Logger.log(`Error parseando respuesta JSON: ${responseText}`);
    throw new Error(`Error parseando respuesta de Gemini: ${parseError.message}\nRespuesta: ${responseText.substring(0, 500)}`);
  }

  if (responseCode !== 200) {
    const errorMsg = json.error ? JSON.stringify(json.error) : responseText;
    Logger.log(`Error de Gemini API: ${errorMsg}`);
    throw new Error(`Gemini Vision Error (${responseCode}): ${errorMsg}`);
  }
  
  // Validar estructura de respuesta
  if (!json.candidates || json.candidates.length === 0) {
    Logger.log(`Respuesta sin candidates: ${JSON.stringify(json)}`);
    throw new Error(`Gemini Vision Error: La respuesta no contiene candidates. Respuesta completa: ${JSON.stringify(json)}`);
  }
  
  if (!json.candidates[0].content || !json.candidates[0].content.parts || json.candidates[0].content.parts.length === 0) {
    Logger.log(`Respuesta con estructura inesperada: ${JSON.stringify(json.candidates[0])}`);
    throw new Error(`Gemini Vision Error: La respuesta tiene una estructura inesperada. Candidate: ${JSON.stringify(json.candidates[0])}`);
  }
  
  const text = json.candidates[0].content.parts[0].text;
  if (!text) {
    Logger.log(`Respuesta sin texto: ${JSON.stringify(json.candidates[0])}`);
    throw new Error(`Gemini Vision Error: La respuesta no contiene texto. Candidate: ${JSON.stringify(json.candidates[0])}`);
  }
  
  Logger.log(`Respuesta exitosa de Gemini (${text.length} caracteres)`);
  return text;
}

// ============================================================
// UTILIDADES DE TELEGRAM
// ============================================================
function sendTelegramMsg(chatId, text, keyboard = null) {
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
  const payload = {
    chat_id: chatId.toString(),
    text: text,
    parse_mode: "Markdown"
  };
  
  if (keyboard) {
    payload.reply_markup = JSON.stringify(keyboard);
  }
  
  const options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };
  
  const response = UrlFetchApp.fetch(url, options);
  const result = JSON.parse(response.getContentText());
  
  // Retornar el message_id para poder editarlo después
  return result.result ? result.result.message_id : null;
}

function actualizarMensaje(chatId, messageId, newText) {
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/editMessageText`;
  const payload = {
    chat_id: chatId.toString(),
    message_id: messageId,
    text: newText,
    parse_mode: "Markdown"
  };
  
  const options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };
  
  UrlFetchApp.fetch(url, options);
}

function answerCallback(callbackId, text) {
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/answerCallbackQuery`;
  const payload = {
    callback_query_id: callbackId,
    text: text
  };
  
  const options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };
  
  UrlFetchApp.fetch(url, options);
}

function generarResumen(data) {
  const d = data.datos;
  if (data.tipo === "GASTO") {
    return `📝 ${d.descripcion} - $${d.monto}\n🏷️ ${d.macro_categoria} → ${d.subcategoria}`;
  } else if (data.tipo === "INGRESO") {
    return `💰 ${d.fuente} - $${d.monto}`;
  } else {
    return `🔄 ${d.origen} → ${d.destino}`;
  }
}

// ============================================================
// CONFIGURACIÓN DE PESTAÑA "MIS_DATOS" (IMPORTANTE)
// ============================================================
/*
Para que el bot pueda identificar correctamente INGRESOS vs EGRESOS,
creá una pestaña llamada "MIS_DATOS" en tu spreadsheet con esta estructura:

    A                 B
1   Campo             Valor
2   Nombre            Juan Pérez
3   Alias             mi.alias.mp, juan.banco.uy
4   CBU/CVU           0170000000000000000001
5   CUIT/CUIL         20-12345678-9

NOTAS:
- Los alias van separados por comas (sin espacios extras)
- CBU/CVU y CUIT son opcionales, pero mejoran la precisión
- El nombre debe coincidir con cómo aparece en los comprobantes

Si no creás esta pestaña, el bot usará valores por defecto
(los cuales debés reemplazar en la función obtenerDatosPersonales()).
*/

// ============================================================
// FUNCIÓN PARA ACTIVAR EL BOT (Ejecutar una sola vez)
// ============================================================
function setWebhook() {
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/setWebhook?url=${WEBHOOK_URL}`;
  const res = UrlFetchApp.fetch(url);
  Logger.log(res.getContentText());
}

