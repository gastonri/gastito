import { describe, expect, test } from "bun:test";
import { mapTransactionIndices } from "../services/validator";
import { currentDolar, renderConfirmation, toggleDolar } from "./confirmation";
import type { ConfigData, TransactionResult } from "../types";

const config: ConfigData = {
  macroCategorias: ["TECNOLOGÍA"],
  subcategorias: ["Suscripciones digitales"],
  categoriasMap: { TECNOLOGÍA: ["Suscripciones digitales"] },
};

function usd(cotizacion?: unknown): TransactionResult {
  return mapTransactionIndices(
    {
      tipo: "GASTO",
      datos: {
        descripcion: "Claude",
        monto: 20,
        macro_categoria: 1 as never,
        subcategoria: 1 as never,
        moneda: 2 as never,
        cotizacion: cotizacion as never,
      },
    },
    config
  );
}

describe("dólar tarjeta / blue", () => {
  test("defaults to TARJETA for USD and drops the field for ARS", () => {
    expect(usd().datos.cotizacion).toBe("TARJETA");
    expect(usd("blue").datos.cotizacion).toBe("BLUE");
    expect(usd("cualquier cosa").datos.cotizacion).toBe("TARJETA");

    const ars = mapTransactionIndices(
      {
        tipo: "GASTO",
        datos: {
          monto: 5,
          macro_categoria: 1 as never,
          subcategoria: 1 as never,
          moneda: 1 as never,
          cotizacion: "BLUE",
        },
      },
      config
    );
    expect(ars.datos.cotizacion).toBeUndefined();
  });

  test("toggle flips the rate and the keyboard offers the other one", () => {
    const results = [usd()];
    expect(currentDolar(results)).toBe("TARJETA");
    expect(
      renderConfirmation(results, "op1")
        .keyboard.inline_keyboard.flat()
        .map((b) => b.callback_data)
    ).toContain("fx_op1");
    expect(JSON.stringify(renderConfirmation(results, "op1").keyboard)).toContain("blue");

    toggleDolar(results);
    expect(results[0].datos.cotizacion).toBe("BLUE");
    expect(JSON.stringify(renderConfirmation(results, "op1").keyboard)).toContain("tarjeta");
  });

  test("confirmation shows the rate and the ARS equivalent", () => {
    const r = usd();
    r.tipo_cambio = 2028;
    const { text } = renderConfirmation([r], "op1");
    expect(text).toContain("Dólar tarjeta ($2.028)");
    expect(text).toContain("≈ $40.560 ARS");
  });

  test("no dollar button for ARS-only operations", () => {
    const ars: TransactionResult = {
      tipo: "GASTO",
      datos: { descripcion: "Café", monto: 2500, moneda: "ARS" },
    };
    const callbacks = renderConfirmation([ars], "op2")
      .keyboard.inline_keyboard.flat()
      .map((b) => b.callback_data);
    expect(callbacks).not.toContain("fx_op2");
  });
});
