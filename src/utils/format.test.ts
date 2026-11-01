import { describe, expect, test } from "bun:test";
import { escapeMarkdown, formatAmount, formatFecha, formatMoney } from "./format";
import { MessageBuilder } from "../bot/message-builder";
import { toUserMessage, UserFacingError } from "../bot/error-handler";

describe("format", () => {
  test("formatMoney uses es-AR separators", () => {
    expect(formatMoney(1500000)).toBe("1.500.000");
    expect(formatAmount(4500, "USD")).toBe("$4.500 USD");
    expect(formatAmount(10)).toBe("$10 ARS");
  });

  test("formatFecha shows today with weekday when missing", () => {
    expect(formatFecha(undefined, new Date("2026-11-01T15:00:00Z"))).toBe("Hoy (dom 1/11)");
  });

  test("formatFecha normalizes ISO and DD/MM/YYYY", () => {
    expect(formatFecha("2026-01-03T03:00:00.000Z")).toBe("03/01/2026");
    expect(formatFecha("3/1/2026")).toBe("03/01/2026");
  });

  test("escapeMarkdown escapes legacy markdown chars", () => {
    expect(escapeMarkdown("a_b*c`d[e")).toBe("a\\_b\\*c\\`d\\[e");
  });
});

describe("messages", () => {
  test("confirmation shows formatted amount and date", () => {
    const msg = MessageBuilder.buildConfirmationMessage({
      tipo: "GASTO",
      datos: {
        descripcion: "Café",
        monto: 1500000,
        macro_categoria: "Comida",
        subcategoria: "Café",
      },
    });
    expect(msg).toContain("¿Lo anoto?");
    expect(msg).toContain("$1.500.000 ARS");
    expect(msg).toContain("Hoy (");
  });

  test("technical errors are never leaked to the user", () => {
    expect(toUserMessage(new Error("Failed to read GASTOS: invalid_grant xyz"))).not.toContain(
      "xyz"
    );
    expect(toUserMessage(new Error("No result from message handler"))).toContain(
      "No pude identificar"
    );
    expect(toUserMessage(new UserFacingError("hola"))).toBe("hola");
  });
});
