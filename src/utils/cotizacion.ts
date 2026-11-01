export interface CotizacionRow {
  date: Date;
  precio: number;
}

/**
 * Parses a number as shown by our sheets, which use "." as the decimal separator
 * ("1898", "1891.5"). Commas, if any, are thousands separators ("1,891.5").
 */
function parsePrecio(raw: string): number {
  return parseFloat(raw.replace(/[$\s,]/g, ""));
}

/** Parses "4/6/2026 12:17:13" or "4/6/2026" (D/M/YYYY) to a local date at midnight. */
function parseSheetDate(raw: string): Date | null {
  const m = raw.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
}

/** Converts the raw rows of the "Dolar Tarjeta" sheet (fecha, precio) into sorted entries. */
export function parseCotizacionRows(rows: unknown[][]): CotizacionRow[] {
  const result: CotizacionRow[] = [];
  for (const row of rows) {
    if (typeof row[0] !== "string" || row[1] === undefined || row[1] === null) continue;
    const date = parseSheetDate(row[0]);
    const precio = parsePrecio(typeof row[1] === "string" ? row[1] : String(row[1] as number));
    if (!date || isNaN(precio) || precio <= 0) continue;
    result.push({ date, precio });
  }
  return result.sort((a, b) => a.date.getTime() - b.date.getTime());
}

/**
 * Picks the rate in force on `fecha`: the latest entry on or before that day.
 * If the date is older than the first entry, falls back to the earliest one.
 * Returns null only when there are no entries at all.
 */
export function pickCotizacion(rows: CotizacionRow[], fecha: Date): number | null {
  if (rows.length === 0) return null;
  const target = new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate()).getTime();
  let chosen: CotizacionRow | null = null;
  for (const row of rows) {
    if (row.date.getTime() <= target) chosen = row;
    else break;
  }
  return (chosen ?? rows[0]).precio;
}
