import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import { SheetsClient } from "./client";

type Req = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** SheetsClient with a fake Google Sheets API that records every write. */
function makeClient(gastosRows: string[][] = [["fecha"], ["1/6/2026"], ["2/6/2026"]]) {
  const batches: Req[][] = [];
  const valueUpdates: { range: string; values: unknown[][] }[] = [];
  const dolarTarjeta = [
    ["fecha", "precio"],
    ["4/6/2026 12:17:13", "1898"],
    ["5/6/2026 9:16:21", "1891.5"],
  ];
  const dolarBlue = [
    ["fecha", "precio"],
    ["1/11/2026 13:23:55", "1565"],
  ];
  const fakeSheets = {
    spreadsheets: {
      get: () =>
        Promise.resolve({
          data: {
            sheets: [
              { properties: { title: "GASTOS", sheetId: 111 } },
              { properties: { title: "INGRESOS", sheetId: 222 } },
              { properties: { title: "PLANTILLA_GASTOS", sheetId: 333 } },
            ],
          },
        }),
      batchUpdate: ({ requestBody }: { requestBody: { requests: Req[] } }) => {
        batches.push(requestBody.requests);
        return Promise.resolve({});
      },
      values: {
        get: ({ range }: { range: string }) => {
          if (range.startsWith("'Dolar Blue'"))
            return Promise.resolve({ data: { values: dolarBlue } });
          if (range.startsWith("'Dolar Tarjeta'"))
            return Promise.resolve({ data: { values: dolarTarjeta } });
          if (range.startsWith("CONFIG"))
            return Promise.resolve({ data: { values: [["Software/Licencias"]] } });
          return Promise.resolve({ data: { values: gastosRows } });
        },
        update: ({
          range,
          requestBody,
        }: {
          range: string;
          requestBody: { values: unknown[][] };
        }) => {
          valueUpdates.push({ range, values: requestBody.values });
          return Promise.resolve({});
        },
      },
    },
  };
  const client = Object.create(SheetsClient.prototype) as Record<string, unknown>;
  client.sheets = fakeSheets;
  client.spreadsheetId = "test";
  client.gastosCache = null;
  client.sheetIds = null;
  return { client: client as unknown as SheetsClient, batches, valueUpdates };
}

/** Pulls the cells written by an updateCells request that starts at the given column. */
function cellsAt(requests: Req[], column: number): Req[] {
  const req = requests.find((r) => r.updateCells?.start?.columnIndex === column);
  return req?.updateCells.rows[0].values ?? [];
}

const valueOf = (cell: Req | undefined) =>
  cell?.userEnteredValue?.numberValue ?? cell?.userEnteredValue?.stringValue;

describe("SheetsClient.writeGasto (single atomic write)", () => {
  test("sends everything in ONE batchUpdate, never a second write", async () => {
    const { client, batches, valueUpdates } = makeClient();
    await client.writeGasto({
      fecha: "05/06/2026",
      descripcion: "Café",
      macro_categoria: "ALIMENTACIÓN",
      subcategoria: "Café y Snacks",
      monto: 12500.499,
      moneda: "ARS",
      mi_parte: 50,
    });
    expect(batches).toHaveLength(1);
    expect(valueUpdates).toHaveLength(0);
  });

  test("writes inputs as plain numbers with '.' decimals, rounded to cents", async () => {
    const { client, batches } = makeClient();
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
    const requests = batches[0];

    // Row 4 (zero-based 3): after the 2 existing data rows plus the header
    const fecha = cellsAt(requests, 0)[0];
    expect(
      requests.find((r) => r.updateCells?.start?.columnIndex === 0).updateCells.start.rowIndex
    ).toBe(3);
    expect(fecha.userEnteredValue.numberValue).toBe(46178); // 5/6/2026 as a Sheets date serial
    expect(fecha.userEnteredFormat.numberFormat.pattern).toBe("d/M/yyyy");

    const inputs = cellsAt(requests, 1).map(valueOf); // B:I
    expect(inputs).toEqual(["", "Café", "ALIMENTACIÓN", "Café y Snacks", 12500.5, "ARS", 1, 1]);

    const kToM = cellsAt(requests, 10).map(valueOf);
    expect(kToM).toEqual([50, "", ""]);
    expect(written).toMatchObject({ sheet: "GASTOS", row: 4, monto: 12500.5, fecha: "05/06/2026" });
  });

  test("derived columns come from the template row, and the app writes no formulas itself", async () => {
    const { client, batches } = makeClient();
    await client.writeGasto({ fecha: "05/06/2026", descripcion: "x", monto: 1 });
    const requests = batches[0];

    const pastes = requests.filter((r) => r.copyPaste).map((r) => r.copyPaste);
    expect(pastes).toHaveLength(2);
    expect(pastes.every((p) => p.pasteType === "PASTE_FORMULA")).toBe(true);
    expect(pastes.every((p) => p.source.sheetId === 333 && p.source.startRowIndex === 1)).toBe(
      true
    );
    // J (imp_mensual) and N:P (año, mes, dia) -> destination row 4 of GASTOS
    expect(pastes.map((p) => [p.source.startColumnIndex, p.source.endColumnIndex])).toEqual([
      [9, 10],
      [13, 16],
    ]);
    expect(
      pastes.every((p) => p.destination.sheetId === 111 && p.destination.startRowIndex === 3)
    ).toBe(true);

    // No literal formula text is sent by the app
    expect(JSON.stringify(requests)).not.toContain("formulaValue");
  });

  test("copy-paste runs before the inputs are written (inputs are never overwritten)", async () => {
    const { client, batches } = makeClient();
    await client.writeGasto({ fecha: "05/06/2026", descripcion: "x", monto: 1 });
    const kinds = batches[0].map((r) => (r.copyPaste ? "paste" : "update"));
    expect(kinds).toEqual(["paste", "paste", "update", "update", "update", "update"]);
  });

  test("USD expense stores the rate used in tipo_cambio (col Q) and a note", async () => {
    const { client, batches } = makeClient();
    await client.writeGasto({
      fecha: "05/06/2026",
      descripcion: "Anthropic",
      macro_categoria: "TECNOLOGÍA",
      subcategoria: "Software/Licencias",
      monto: 5,
      moneda: "USD",
    });
    const requests = batches[0];
    expect(valueOf(cellsAt(requests, 16)[0])).toBe(1891.5); // 5/6 rate from Dolar Tarjeta
    expect(valueOf(cellsAt(requests, 10)[2])).toBe("USD a dólar tarjeta $1891.5");
    expect(valueOf(cellsAt(requests, 1)[5])).toBe("USD");
  });

  test("USD with cotizacion BLUE uses the Dolar Blue sheet", async () => {
    const { client, batches } = makeClient();
    await client.writeGasto({
      fecha: "05/06/2026",
      descripcion: "Hotel",
      macro_categoria: "ENTRETENIMIENTO",
      subcategoria: "Viajes/Turismo",
      monto: 50,
      moneda: "USD",
      cotizacion: "BLUE",
      notas: "Efectivo",
    });
    const requests = batches[0];
    // The blue sheet only has 1/11, so it falls back to its earliest rate.
    expect(valueOf(cellsAt(requests, 16)[0])).toBe(1565);
    expect(valueOf(cellsAt(requests, 10)[2])).toBe("Efectivo · USD a dólar blue $1565");
  });

  test("ARS expense leaves tipo_cambio empty", async () => {
    const { client, batches } = makeClient();
    await client.writeGasto({ fecha: "05/06/2026", descripcion: "x", monto: 10, moneda: "ARS" });
    expect(cellsAt(batches[0], 16)[0]).toEqual({});
  });

  test("cuotas: the total amount is stored; the sheet divides it", async () => {
    const { client, batches } = makeClient();
    await client.writeGasto({
      fecha: "05/06/2026",
      descripcion: "Zapatillas",
      macro_categoria: "INDUMENTARIA",
      subcategoria: "Calzado",
      monto: 150000,
      cuotas: 3,
      n_cuota: 1,
    });
    const inputs = cellsAt(batches[0], 1).map(valueOf);
    expect(inputs[4]).toBe(150000);
    expect(inputs[6]).toBe(3);
  });
});

describe("expense without date", () => {
  afterEach(() => setSystemTime());

  test("is recorded with Argentina's date, not the server's (UTC)", async () => {
    // 01/11/2026 02:00 UTC is still 31/10/2026 23:00 in Argentina.
    setSystemTime(new Date("2026-11-01T02:00:00Z"));
    const { client, batches } = makeClient();
    const written = await client.writeGasto({
      descripcion: "Café",
      macro_categoria: "ALIMENTACIÓN",
      subcategoria: "Café y Snacks",
      monto: 2500,
    });
    expect(written.fecha).toBe("31/10/2026");
    expect(cellsAt(batches[0], 0)[0].userEnteredValue.numberValue).toBe(46326); // 31/10/2026
  });
});

describe("SheetsClient.deleteWrittenRow", () => {
  const rows = [
    ["fecha", "persona", "descripcion", "macro", "sub", "monto"],
    ["1/6/2026", "G", "Café", "A", "B", "2500.00"],
    ["2/6/2026", "G", "Uber", "T", "U", "4600.00"],
    ["3/6/2026", "G", "Café", "A", "B", "2500.00"],
  ];

  test("deletes the stored row when it still matches", async () => {
    const { client, batches } = makeClient(rows);
    const result = await client.deleteWrittenRow({
      sheet: "GASTOS",
      row: 3,
      descripcion: "Uber",
      monto: 4600,
    });
    expect(result).toBe("deleted");
    expect(batches[0][0].deleteDimension.range).toMatchObject({
      sheetId: 111,
      startIndex: 2,
      endIndex: 3,
    });
  });

  test("finds the row by content when a re-sort moved it", async () => {
    const { client, batches } = makeClient(rows);
    // The app recorded row 2 for the Uber, but it is now at row 3.
    const result = await client.deleteWrittenRow({
      sheet: "GASTOS",
      row: 2,
      descripcion: "Uber",
      monto: 4600,
    });
    expect(result).toBe("deleted");
    expect(batches[0][0].deleteDimension.range.startIndex).toBe(2);
  });

  test("uses the date to pick the right one among identical expenses", async () => {
    const { client, batches } = makeClient(rows);
    const result = await client.deleteWrittenRow({
      sheet: "GASTOS",
      row: 9,
      descripcion: "Café",
      monto: 2500,
      fecha: "01/06/2026",
    });
    expect(result).toBe("deleted");
    expect(batches[0][0].deleteDimension.range.startIndex).toBe(1);
  });

  test("never deletes anything when the expense is no longer in the sheet", async () => {
    const { client, batches } = makeClient(rows);
    const result = await client.deleteWrittenRow({
      sheet: "GASTOS",
      row: 2,
      descripcion: "Otro",
      monto: 1,
    });
    expect(result).toBe("mismatch");
    expect(batches).toHaveLength(0);
  });
});
