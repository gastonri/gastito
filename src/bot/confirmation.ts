import type { TransactionResult } from "../types";
import type { SheetsClient } from "../sheets/client";
import { parseDate } from "../services/validator";
import { getArgentinaToday } from "../utils/format";
import { Logger } from "../utils/logger";
import { ClarificationBuilder, type InlineKeyboardMarkup } from "./clarification-builder";
import { MessageBuilder } from "./message-builder";

export type TipoDolar = "TARJETA" | "BLUE";

const isUsdGasto = (r: TransactionResult) => r.tipo === "GASTO" && r.datos.moneda === "USD";

/**
 * Looks up the dollar rate for every USD expense so the confirmation can show the ARS
 * equivalent. Best effort: a missing rate just hides the equivalent.
 */
export async function attachTipoCambio(
  results: TransactionResult[],
  sheetsClient: SheetsClient
): Promise<void> {
  for (const result of results) {
    if (!isUsdGasto(result)) {
      delete result.tipo_cambio;
      continue;
    }
    try {
      const fecha =
        (result.datos.fecha && parseDate(result.datos.fecha)) || getArgentinaToday().date;
      const rate = await sheetsClient.getCotizacionDolar(
        result.datos.cotizacion ?? "TARJETA",
        fecha
      );
      result.tipo_cambio = rate ?? undefined;
    } catch (error) {
      Logger.warn(
        `Could not fetch dollar rate: ${error instanceof Error ? error.message : String(error)}`
      );
      result.tipo_cambio = undefined;
    }
  }
}

/** The rate currently used by the first USD expense, or null if there is none. */
export function currentDolar(results: TransactionResult[]): TipoDolar | null {
  const usd = results.find(isUsdGasto);
  return usd ? (usd.datos.cotizacion ?? "TARJETA") : null;
}

/** Flips every USD expense between dólar tarjeta and dólar blue. */
export function toggleDolar(results: TransactionResult[]): void {
  for (const result of results) {
    if (isUsdGasto(result)) {
      result.datos.cotizacion = result.datos.cotizacion === "BLUE" ? "TARJETA" : "BLUE";
    }
  }
}

/** Confirmation text plus keyboard (confirm / cancel / edit / change dollar rate when it applies). */
export function renderConfirmation(
  results: TransactionResult[],
  operationId: string
): { text: string; keyboard: InlineKeyboardMarkup } {
  const text =
    results.length === 1
      ? MessageBuilder.buildConfirmationMessage(results[0])
      : MessageBuilder.buildMultiConfirmationMessage(results);
  return {
    text,
    keyboard: ClarificationBuilder.buildConfirmCancelKeyboard(operationId, currentDolar(results)),
  };
}

/**
 * Applies a category chosen by the user. The user's choice replaces the model's guess, so any
 * "low confidence" warning is cleared.
 */
export function setCategoria(
  result: TransactionResult,
  choice: { macro: string; sub: string } | { categoria: string }
): void {
  if ("categoria" in choice) {
    result.datos.categoria = choice.categoria;
  } else {
    result.datos.macro_categoria = choice.macro;
    result.datos.subcategoria = choice.sub;
  }
  result.confianza = "ALTA";
  result.campos_faltantes = [];
  delete result.alerta;
}
