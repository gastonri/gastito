import { describe, expect, test } from "bun:test";
import { computeBudgetLines, expensePeriod } from "./budget";

const TODAY = new Date(2026, 10, 1); // 1/11/2026
const presupuestos = [
  { macro_categoria: "ALIMENTACIÓN", monto: 100000 },
  { macro_categoria: "TRANSPORTE", monto: 50000 },
];

// Spent per month, as the sheet would return it (octubre and noviembre differ on purpose).
const GASTOS: Record<string, { macro_categoria: string; monto: number }[]> = {
  "2026-10": [
    { macro_categoria: "ALIMENTACIÓN", monto: 90000 },
    { macro_categoria: "ALIMENTACIÓN", monto: 5000 },
  ],
  "2026-11": [{ macro_categoria: "ALIMENTACIÓN", monto: 10000 }],
};
const calls: string[] = [];
const fetchGastos = (year: number, month: number) => {
  calls.push(`${year}-${month}`);
  return Promise.resolve(GASTOS[`${year}-${month}`] ?? []);
};

describe("expensePeriod", () => {
  test("uses the expense date, not today", () => {
    expect(expensePeriod("15/10/2026", TODAY)).toEqual({ year: 2026, month: 10 });
    expect(expensePeriod("2026-09-30T03:00:00.000Z", TODAY)).toEqual({ year: 2026, month: 9 });
  });

  test("falls back to today when there is no date", () => {
    expect(expensePeriod(undefined, TODAY)).toEqual({ year: 2026, month: 11 });
    expect(expensePeriod("", TODAY)).toEqual({ year: 2026, month: 11 });
  });
});

describe("computeBudgetLines", () => {
  test("measures the month the expense was recorded for", async () => {
    calls.length = 0;
    const lines = await computeBudgetLines(
      [{ tipo: "GASTO", datos: { fecha: "28/10/2026", macro_categoria: "ALIMENTACIÓN" } }],
      presupuestos,
      fetchGastos,
      TODAY
    );
    expect(calls).toEqual(["2026-10"]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      categoria: "ALIMENTACIÓN",
      month: 10,
      gastado: 95000,
      pct: 95,
    });
  });

  test("an expense without date counts for the current month", async () => {
    const lines = await computeBudgetLines(
      [{ tipo: "GASTO", datos: { macro_categoria: "ALIMENTACIÓN" } }],
      presupuestos,
      fetchGastos,
      TODAY
    );
    expect(lines[0]).toMatchObject({ month: 11, gastado: 10000, pct: 10 });
  });

  test("expenses from different months are reported separately, oldest first", async () => {
    const lines = await computeBudgetLines(
      [
        { tipo: "GASTO", datos: { macro_categoria: "ALIMENTACIÓN" } },
        { tipo: "GASTO", datos: { fecha: "28/10/2026", macro_categoria: "ALIMENTACIÓN" } },
      ],
      presupuestos,
      fetchGastos,
      TODAY
    );
    expect(lines.map((l) => [l.month, l.pct])).toEqual([
      [10, 95],
      [11, 10],
    ]);
  });

  test("ignores incomes and categories without budget", async () => {
    const lines = await computeBudgetLines(
      [
        { tipo: "INGRESO", datos: { macro_categoria: "ALIMENTACIÓN" } },
        { tipo: "GASTO", datos: { macro_categoria: "SALUD" } },
      ],
      presupuestos,
      fetchGastos,
      TODAY
    );
    expect(lines).toEqual([]);
  });
});
