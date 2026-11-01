import { describe, expect, test } from "bun:test";
import { mapTransactionIndices } from "../services/validator";
import { currentDolar, renderConfirmation, setCategoria, toggleDolar } from "./confirmation";
import { ClarificationBuilder } from "./clarification-builder";
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

describe("cambio de categoría", () => {
  const UUID = "123e4567-e89b-12d3-a456-426614174000";
  const bytes = (s: string) => new TextEncoder().encode(s).length;

  test("the confirmation keyboard offers a category button", () => {
    const ars: TransactionResult = {
      tipo: "GASTO",
      datos: { descripcion: "Café", monto: 2500, moneda: "ARS" },
    };
    const callbacks = renderConfirmation([ars], UUID)
      .keyboard.inline_keyboard.flat()
      .map((b) => b.callback_data);
    expect(callbacks).toContain(`cat_${UUID}`);
  });

  test("every picker button fits in Telegram's 64 byte callback_data limit", () => {
    const macros = Array.from({ length: 12 }, (_, i) => `MACRO ${i}`);
    const subs = Array.from({ length: 8 }, (_, i) => `Sub ${i}`);
    const keyboards = [
      ClarificationBuilder.buildItemPicker(UUID, ["a", "b", "c"]),
      ClarificationBuilder.buildMacroPicker(UUID, 9, macros, `cb_${UUID}`),
      ClarificationBuilder.buildSubPicker(UUID, 9, 11, subs, `ci_${UUID}_9`),
      ClarificationBuilder.buildIngresoCategoryPicker(UUID, 9, ["Sueldo", "Otro"], `cb_${UUID}`),
    ];
    for (const kb of keyboards) {
      for (const button of kb.inline_keyboard.flat()) {
        expect(bytes(button.callback_data)).toBeLessThanOrEqual(64);
      }
    }
  });

  test("macro picker lays out two buttons per row plus a back row", () => {
    const kb = ClarificationBuilder.buildMacroPicker(UUID, 0, ["A", "B", "C"], `cb_${UUID}`);
    expect(kb.inline_keyboard.map((row) => row.length)).toEqual([2, 1, 1]);
    expect(kb.inline_keyboard.at(-1)?.[0].callback_data).toBe(`cb_${UUID}`);
  });

  test("setCategoria replaces the guess and clears the low confidence warning", () => {
    const r: TransactionResult = {
      tipo: "GASTO",
      datos: {
        descripcion: "Lo de Marta",
        monto: 12000,
        macro_categoria: "ALIMENTACIÓN",
        subcategoria: "Restaurante",
      },
      confianza: "BAJA",
      campos_faltantes: ["subcategoria"],
      alerta: "⚠️ Confianza BAJA",
    };
    setCategoria(r, { macro: "SALUD", sub: "Farmacia" });
    expect(r.datos.macro_categoria).toBe("SALUD");
    expect(r.datos.subcategoria).toBe("Farmacia");
    expect(r.confianza).toBe("ALTA");
    expect(r.campos_faltantes).toEqual([]);
    expect(r.alerta).toBeUndefined();
  });

  test("setCategoria for income only changes the income category", () => {
    const r: TransactionResult = {
      tipo: "INGRESO",
      datos: { descripcion: "Pago", monto: 1, categoria: "Otro" },
    };
    setCategoria(r, { categoria: "Sueldo" });
    expect(r.datos.categoria).toBe("Sueldo");
  });
});
