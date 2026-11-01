/**
 * Parses an amount written the Argentine way: "." for thousands and "," for decimals
 * ("1.500" = 1500, "12.500,50" = 12500.5). Also tolerates "1500.50" and "1,5".
 * Returns null if no valid positive number is found.
 */
export function parseMontoAR(raw: string | number | undefined | null): number | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw === "number") return isFinite(raw) && raw > 0 ? raw : null;

  const token = raw.replace(/[$\s]/g, "").match(/\d[\d.,]*/)?.[0];
  if (!token) return null;
  const clean = token.replace(/[.,]+$/, "");

  const lastDot = clean.lastIndexOf(".");
  const lastComma = clean.lastIndexOf(",");
  let normalized: string;

  if (lastDot >= 0 && lastComma >= 0) {
    // The last separator is the decimal one.
    const decimalIsComma = lastComma > lastDot;
    normalized = decimalIsComma
      ? clean.replace(/\./g, "").replace(",", ".")
      : clean.replace(/,/g, "");
  } else if (lastComma >= 0) {
    const isThousands = /^\d{1,3}(,\d{3})+$/.test(clean);
    normalized = isThousands ? clean.replace(/,/g, "") : clean.replace(",", ".");
  } else if (lastDot >= 0) {
    const isThousands = /^\d{1,3}(\.\d{3})+$/.test(clean);
    normalized = isThousands ? clean.replace(/\./g, "") : clean;
  } else {
    normalized = clean;
  }

  const value = parseFloat(normalized);
  return isFinite(value) && value > 0 ? value : null;
}
