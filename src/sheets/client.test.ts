import { describe, expect, test } from "bun:test";
import { SheetsClient } from "./client";

interface Update {
  range: string;
  values: unknown[][];
}

/** SheetsClient with a fake Google Sheets API that records every write. */
function makeClient() {
  const updates: Update[] = [];
  const dolarTarjeta = [
    ["fecha", "precio"],
    ["4/6/2026 12:17:13", "1898"],
    ["5/6/2026 9:16:21", "1891.5"],
  ];
  const fakeSheets = {
    spreadsheets: {
      values: {
        get: ({ range }: { range: string }) => {
          if (range.startsWith("'Dolar Tarjeta'"))
            return Promise.resolve({ data: { values: dolarTarjeta } });
          if (range.startsWith("CONFIG"))
            return Promise.resolve({ data: { values: [["Software/Licencias"]] } });
          return Promise.resolve({ data: { values: [["fecha"], ["1/6/2026"], ["2/6/2026"]] } });
        },
        update: ({
          range,
          requestBody,
        }: {
          range: string;
          requestBody: { values: unknown[][] };
        }) => {
          updates.push({ range, values: requestBody.values });
          return Promise.resolve({});
        },
      },
    },
  };
  const client = Object.create(SheetsClient.prototype) as Record<string, unknown>;
  client.sheets = fakeSheets;
  client.spreadsheetId = "test";
  client.gastosCache = null;
  return { client: client as unknown as SheetsClient, updates };
}

describe("SheetsClient.writeGasto", () => {
  test("ARS expense is written as plain numbers with '.' decimals", async () => {
    const { client, updates } = makeClient();
    const written = await client.writeGasto({
      fecha: "05/06/2026",
      descripcion: "Café",
      macro_categoria: "ALIMENTACIÓN",
      subcategoria: "Café y Snacks",
      monto: 12500.499,
      moneda: "ARS",
      cuotas: 1,
      n_cuota: 1,
      mi_parte: 50,
    });

    const [ai, jp] = updates;
    expect(ai.range).toBe("GASTOS!A4:I4");
    expect(ai.values[0][5]).toBe(12500.5); // number, rounded to cents
    expect(typeof ai.values[0][5]).toBe("number");
    expect(ai.values[0][6]).toBe("ARS");
    expect(jp.values[0][0]).toBe('=IFERROR(IF(H4>0,F4/H4,F4),"")');
    expect(written).toMatchObject({ sheet: "GASTOS", row: 4, monto: 12500.5 });
  });

  test("USD expense multiplies imp_mensual by the Dolar Tarjeta rate of that day", async () => {
    const { client, updates } = makeClient();
    await client.writeGasto({
      fecha: "05/06/2026",
      descripcion: "Anthropic",
      macro_categoria: "TECNOLOGÍA",
      subcategoria: "Software/Licencias",
      monto: 5,
      moneda: "USD",
    });

    expect(updates[0].values[0][5]).toBe(5);
    expect(updates[0].values[0][6]).toBe("USD");
    // 5 USD * 1891.5 = 9457.5 (same value as the existing USD rows in the sheet)
    expect(updates[1].values[0][0]).toBe('=IFERROR(IF(H4>0,F4/H4,F4)*1891.5,"")');
  });

  test("cuotas: imp_mensual divides the total amount", async () => {
    const { client, updates } = makeClient();
    await client.writeGasto({
      fecha: "05/06/2026",
      descripcion: "Zapatillas",
      macro_categoria: "INDUMENTARIA",
      subcategoria: "Calzado",
      monto: 150000,
      cuotas: 3,
      n_cuota: 1,
    });
    expect(updates[0].values[0][5]).toBe(150000);
    expect(updates[0].values[0][7]).toBe("3");
    expect(updates[1].values[0][0]).toContain("F4/H4");
  });
});
