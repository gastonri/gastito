export const MONTH_NAMES_ES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

export const MONTH_NAMES_ES_CAP = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

export interface Period {
  year: number;
  month: number;
}

export function previousPeriod(p: Period): Period {
  return p.month === 1 ? { year: p.year - 1, month: 12 } : { year: p.year, month: p.month - 1 };
}

/**
 * Resolves a month name to a Period. If the month hasn't happened yet this year,
 * assumes the user means last year's occurrence (e.g. asking for "diciembre" in enero).
 */
export function resolveMonthName(
  name: string,
  currentMonth: number,
  currentYear: number
): Period | null {
  const idx = MONTH_NAMES_ES.indexOf(name.toLowerCase());
  if (idx === -1) return null;
  const month = idx + 1;
  const year = month > currentMonth ? currentYear - 1 : currentYear;
  return { year, month };
}

/**
 * Parses trailing command args as an optional "<mes> [año]" period, e.g. ["julio"] or
 * ["julio", "2025"]. Returns the current month/year when no args are given, or null
 * if the month name isn't recognized.
 */
export function parsePeriodArgs(args: string[]): Period | null {
  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();

  if (args.length === 0) {
    return { year: currentYear, month: currentMonth };
  }

  const resolved = resolveMonthName(args[0], currentMonth, currentYear);
  if (!resolved) return null;

  if (args.length >= 2 && /^\d{4}$/.test(args[1])) {
    return { year: parseInt(args[1], 10), month: resolved.month };
  }

  return resolved;
}
