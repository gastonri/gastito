import { parseDate } from "../services/validator";

const TIME_ZONE = "America/Argentina/Buenos_Aires";

/** Escapes characters that break Telegram's legacy Markdown parse mode. */
export function escapeMarkdown(text: string | undefined): string {
  if (!text) return "";
  return text.replace(/([_*`[])/g, "\\$1");
}

/** Formats an amount with es-AR separators, e.g. 1500000 -> "1.500.000". */
export function formatMoney(monto: number | undefined): string {
  const value = typeof monto === "number" && !isNaN(monto) ? monto : 0;
  return value.toLocaleString("es-AR", { maximumFractionDigits: 2 });
}

/** Amount with currency, e.g. "$1.500 ARS". */
export function formatAmount(monto: number | undefined, moneda?: string): string {
  return `$${formatMoney(monto)} ${moneda || "ARS"}`;
}

/** Today's date as "sáb 1/11" in Argentina's time zone. */
export function formatTodayShort(now: Date = new Date()): string {
  const weekday = new Intl.DateTimeFormat("es-AR", { weekday: "short", timeZone: TIME_ZONE })
    .format(now)
    .replace(".", "");
  const dayMonth = new Intl.DateTimeFormat("es-AR", {
    day: "numeric",
    month: "numeric",
    timeZone: TIME_ZONE,
  }).format(now);
  return `${weekday} ${dayMonth}`;
}

/**
 * Human-friendly date. Missing dates are shown as "Hoy (sáb 1/11)" so the user
 * sees which day will actually be recorded; explicit dates are normalized to DD/MM/YYYY.
 */
export function formatFecha(fecha: string | undefined, now: Date = new Date()): string {
  if (!fecha) return `Hoy (${formatTodayShort(now)})`;
  const parsed = parseDate(fecha);
  if (!parsed) return fecha;
  const dd = String(parsed.getDate()).padStart(2, "0");
  const mm = String(parsed.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${parsed.getFullYear()}`;
}

/** Today's date in Argentina's time zone (the server may run in UTC). */
export function getArgentinaToday(now: Date = new Date()): { weekday: string; date: Date } {
  const parts = new Intl.DateTimeFormat("es-AR", {
    timeZone: TIME_ZONE,
    weekday: "long",
    day: "numeric",
    month: "numeric",
    year: "numeric",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    weekday: get("weekday"),
    date: new Date(Number(get("year")), Number(get("month")) - 1, Number(get("day"))),
  };
}

/** DD/MM/YYYY, optionally shifted by whole days. */
export function formatDDMMYYYY(date: Date, shiftDays = 0): string {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate() + shiftDays);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}
