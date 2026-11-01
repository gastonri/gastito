/**
 * Cotizaciones del dólar. Cada función agrega una fila (fecha, precio) a su hoja.
 * Los nombres son DISTINTOS a propósito: dos funciones con el mismo nombre en el mismo
 * proyecto se pisan y solo corre la última.
 *
 * Disparadores diarios (Activadores > Añadir activador > basado en tiempo):
 *   fetchDolarTarjeta -> hoja "Dolar Tarjeta"
 *   fetchDolarBlue    -> hoja "Dolar Blue"
 */
function fetchDolarTarjeta() {
  registrarDolar_("tarjeta", "Dolar Tarjeta");
}

function fetchDolarBlue() {
  registrarDolar_("blue", "Dolar Blue");
}

function registrarDolar_(tipo, nombreHoja) {
  const respuesta = UrlFetchApp.fetch("https://dolarapi.com/v1/dolares/" + tipo);
  const data = JSON.parse(respuesta.getContentText());

  const precio = Number(data.venta);
  if (!isFinite(precio) || precio <= 0) {
    throw new Error("Cotización inválida para " + tipo + ": " + respuesta.getContentText());
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const hoja = ss.getSheetByName(nombreHoja) || ss.insertSheet(nombreHoja);

  if (hoja.getLastRow() === 0) {
    hoja.appendRow(["fecha", "precio"]);
  }
  hoja.appendRow([new Date(), precio]);
}
