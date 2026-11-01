import { parseDate } from "./validator";
import { getArgentinaToday } from "../utils/format";

export interface BudgetLineData {
  categoria: string;
  year: number;
  month: number;
  gastado: number;
  presupuesto: number;
  pct: number;
}

type SavedItem = { tipo: string; datos: { fecha?: string; macro_categoria?: string } };

/** Year/month an expense belongs to: its own date, or today (Argentina) if it has none. */
export function expensePeriod(
  fecha: string | undefined,
  today: Date = getArgentinaToday().date
): { year: number; month: number } {
  const date = (fecha && parseDate(fecha)) || today;
  return { year: date.getFullYear(), month: date.getMonth() + 1 };
}

/**
 * Budget progress for the categories just saved, measured in the month each expense was
 * recorded for (not the current month). Expenses from different months are checked separately.
 */
export async function computeBudgetLines(
  saved: SavedItem[],
  presupuestos: { macro_categoria: string; monto: number }[],
  fetchGastos: (
    year: number,
    month: number
  ) => Promise<{ macro_categoria: string; monto: number }[]>,
  today: Date = getArgentinaToday().date
): Promise<BudgetLineData[]> {
  const categoriasPorMes = new Map<
    string,
    { year: number; month: number; categorias: Set<string> }
  >();

  for (const item of saved) {
    if (item.tipo !== "GASTO" || !item.datos.macro_categoria) continue;
    const { year, month } = expensePeriod(item.datos.fecha, today);
    const key = `${year}-${month}`;
    const entry = categoriasPorMes.get(key) ?? { year, month, categorias: new Set<string>() };
    entry.categorias.add(item.datos.macro_categoria);
    categoriasPorMes.set(key, entry);
  }

  const lines: BudgetLineData[] = [];
  const ordered = [...categoriasPorMes.values()].sort(
    (a, b) => a.year - b.year || a.month - b.month
  );

  for (const { year, month, categorias } of ordered) {
    const presupuestosDelMes = presupuestos.filter(
      (p) => categorias.has(p.macro_categoria) && p.monto > 0
    );
    if (presupuestosDelMes.length === 0) continue;

    const gastos = await fetchGastos(year, month);
    for (const p of presupuestosDelMes) {
      const gastado = gastos
        .filter((g) => g.macro_categoria === p.macro_categoria)
        .reduce((sum, g) => sum + g.monto, 0);
      lines.push({
        categoria: p.macro_categoria,
        year,
        month,
        gastado,
        presupuesto: p.monto,
        pct: Math.round((gastado / p.monto) * 100),
      });
    }
  }
  return lines;
}
