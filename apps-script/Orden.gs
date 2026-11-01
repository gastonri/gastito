/**
 * Mantiene la hoja GASTOS ordenada por fecha (columna A).
 *
 * Reglas de diseño (ver docs/SHEETS.md):
 *  - Este script NO escribe ninguna otra columna. imp_mensual, año, mes y día los calculan las
 *    fórmulas de la fila 2 de PLANTILLA_GASTOS, que la app copia a cada gasto nuevo.
 *  - La app guarda cada gasto en UNA sola operación, así que ordenar después nunca puede mover
 *    una fila a mitad de una escritura.
 *  - Solo ordena si hace falta: ejecutarlo varias veces seguidas no cambia nada.
 *  - No depende de qué pestaña esté activa.
 */
const HOJA_GASTOS = "GASTOS";

/** Ejecutar UNA vez (desde el editor) para dejar el disparador correcto. */
function instalarDisparadores() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // Borra el disparador viejo (onSheetChange) y cualquier duplicado de este.
  ScriptApp.getProjectTriggers().forEach(function (t) {
    const fn = t.getHandlerFunction();
    if (fn === "onSheetChange" || fn === "ordenarGastos") {
      ScriptApp.deleteTrigger(t);
    }
  });

  ScriptApp.newTrigger("ordenarGastos").forSpreadsheet(ss).onChange().create();
}

/** Disparador "al cambiar la hoja". */
function ordenarGastos() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return; // otra ejecución ya está ordenando

  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(HOJA_GASTOS);
    if (!sheet) return;

    const lastRow = sheet.getLastRow();
    if (lastRow < 3) return; // encabezado + menos de 2 filas: nada que ordenar

    const filas = lastRow - 1;
    const fechas = sheet.getRange(2, 1, filas, 1).getValues();
    if (estaOrdenado_(fechas)) return;

    SpreadsheetApp.flush();
    sheet.getRange(2, 1, filas, sheet.getLastColumn()).sort({ column: 1, ascending: true });
  } finally {
    lock.releaseLock();
  }
}

/** true si las fechas ya están de menor a mayor (las celdas vacías o de texto se ignoran). */
function estaOrdenado_(fechas) {
  let anterior = -Infinity;
  for (let i = 0; i < fechas.length; i++) {
    const valor = fechas[i][0];
    if (!(valor instanceof Date)) continue;
    const t = valor.getTime();
    if (isNaN(t)) continue;
    if (t < anterior) return false;
    anterior = t;
  }
  return true;
}
