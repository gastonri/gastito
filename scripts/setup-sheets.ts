import { google, sheets_v4 } from "googleapis";

const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_SPREADSHEET_ID ?? "";
const CREDENTIALS_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS ?? "";
const CREDENTIALS_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? "";

// ─── Categorías ───────────────────────────────────────────────────────────────

const CATEGORIES: Record<string, string[]> = {
  ALIMENTACIÓN: [
    "🛒 Supermercado",
    "🍽️ Restaurante",
    "☕ Café",
    "🛵 Delivery",
    "🥬 Verdulería",
    "🥩 Carnicería",
  ],
  VIVIENDA: ["🏠 Alquiler", "💡 Servicios", "🧹 Limpieza/Hogar"],
  TRANSPORTE: ["⛽ Combustible", "🚌 Transporte público", "🚕 Taxi/Uber", "✈️ Viajes"],
  SALUD: ["💊 Farmacia", "🏥 Médico", "🦷 Odontología"],
  OCIO: ["🎬 Entretenimiento", "🏋️ Deporte/Gym", "📚 Libros"],
  ROPA: ["👕 Ropa", "👟 Calzado", "👜 Accesorios"],
  TECNOLOGÍA: ["📱 Electrónica", "💻 Suscripciones", "🔌 Accesorios tech"],
  EDUCACIÓN: ["📖 Cursos", "🎓 Instituto"],
};

// ─── Columnas de GASTOS ───────────────────────────────────────────────────────
//
//  A  fecha          DD/MM/YYYY
//  B  persona        quién hizo el gasto (viene del usuario de Telegram)
//  C  descripcion    negocio o descripción libre
//  D  macro_categoria
//  E  subcategoria
//  F  monto
//  G  moneda         ARS | USD
//  H  cuotas         1 si no se especifica
//  I  n_cuota        1 si no se especifica
//  J  imp_mensual    fórmula: =F/H (calculado al escribir cada fila)
//  K  mi_parte_%     0-100, default 100
//  L  link           opcional
//  M  notas          opcional

const GASTOS_HEADERS = [
  "fecha",
  "persona",
  "descripcion",
  "macro_categoria",
  "subcategoria",
  "monto",
  "moneda",
  "cuotas",
  "n_cuota",
  "imp_mensual",
  "mi_parte_%",
  "link",
  "notas",
];

const HEADER_COLOR = { red: 0.18, green: 0.31, blue: 0.47 }; // #2D4F77
const WHITE = { red: 1, green: 1, blue: 1 };

// ─── Auth ─────────────────────────────────────────────────────────────────────

function buildAuth() {
  if (CREDENTIALS_PATH) {
    return new google.auth.GoogleAuth({
      keyFile: CREDENTIALS_PATH,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
  }
  return new google.auth.GoogleAuth({
    credentials: JSON.parse(CREDENTIALS_JSON) as Record<string, unknown>,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getOrCreateSheet(
  sheets: sheets_v4.Sheets,
  title: string,
  existing: sheets_v4.Schema$Sheet[]
): Promise<number> {
  const found = existing.find((s) => s.properties?.title === title);
  if (found) {
    console.log(`  ↩  "${title}" ya existe`);
    return found.properties?.sheetId ?? 0;
  }
  const res = await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { requests: [{ addSheet: { properties: { title } } }] },
  });
  const id = res.data.replies?.[0]?.addSheet?.properties?.sheetId ?? 0;
  console.log(`  +  "${title}" creada (id: ${id})`);
  return id;
}

function headerFormatRequest(
  sheetId: number,
  colCount: number
): sheets_v4.Schema$Request[] {
  return [
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: colCount },
        cell: {
          userEnteredFormat: {
            backgroundColor: HEADER_COLOR,
            textFormat: { bold: true, foregroundColor: WHITE },
            horizontalAlignment: "CENTER",
          },
        },
        fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)",
      },
    },
    {
      updateSheetProperties: {
        properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
        fields: "gridProperties.frozenRowCount",
      },
    },
  ];
}

// ─── Setup GASTOS ─────────────────────────────────────────────────────────────

async function setupGastos(sheets: sheets_v4.Sheets, sheetId: number) {
  await sheets.spreadsheets.values.clear({
    spreadsheetId: SPREADSHEET_ID,
    range: "GASTOS",
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: "GASTOS!A1",
    valueInputOption: "RAW",
    requestBody: { values: [GASTOS_HEADERS] },
  });

  // G = moneda (index 6), K = mi_parte_% (index 10)
  const MONEDA_COL = 6;
  const MI_PARTE_COL = 10;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      requests: [
        ...headerFormatRequest(sheetId, GASTOS_HEADERS.length),
        // Dropdown ARS/USD en columna moneda
        {
          setDataValidation: {
            range: {
              sheetId,
              startRowIndex: 1,
              endRowIndex: 10000,
              startColumnIndex: MONEDA_COL,
              endColumnIndex: MONEDA_COL + 1,
            },
            rule: {
              condition: {
                type: "ONE_OF_LIST",
                values: [{ userEnteredValue: "ARS" }, { userEnteredValue: "USD" }],
              },
              showCustomUi: true,
              strict: false,
            },
          },
        },
        // Validación 0-100 en columna mi_parte_%
        {
          setDataValidation: {
            range: {
              sheetId,
              startRowIndex: 1,
              endRowIndex: 10000,
              startColumnIndex: MI_PARTE_COL,
              endColumnIndex: MI_PARTE_COL + 1,
            },
            rule: {
              condition: { type: "NUMBER_BETWEEN", values: [{ userEnteredValue: "0" }, { userEnteredValue: "100" }] },
              showCustomUi: false,
              strict: false,
            },
          },
        },
        // Anchos de columna
        {
          updateDimensionProperties: {
            range: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: GASTOS_HEADERS.length },
            properties: { pixelSize: 130 },
            fields: "pixelSize",
          },
        },
        // descripcion más ancha
        {
          updateDimensionProperties: {
            range: { sheetId, dimension: "COLUMNS", startIndex: 2, endIndex: 3 },
            properties: { pixelSize: 220 },
            fields: "pixelSize",
          },
        },
        // link y notas más anchas
        {
          updateDimensionProperties: {
            range: { sheetId, dimension: "COLUMNS", startIndex: 11, endIndex: 13 },
            properties: { pixelSize: 200 },
            fields: "pixelSize",
          },
        },
      ],
    },
  });
}

// ─── Setup CONFIG ─────────────────────────────────────────────────────────────

async function setupConfig(sheets: sheets_v4.Sheets, sheetId: number) {
  await sheets.spreadsheets.values.clear({
    spreadsheetId: SPREADSHEET_ID,
    range: "CONFIG",
  });

  const rows: string[][] = [["macro_categoria", "subcategoria"]];
  for (const [macro, subs] of Object.entries(CATEGORIES)) {
    for (const sub of subs) {
      rows.push([macro, sub]);
    }
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: "CONFIG!A1",
    valueInputOption: "RAW",
    requestBody: { values: rows },
  });

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      requests: [
        ...headerFormatRequest(sheetId, 2),
        {
          updateDimensionProperties: {
            range: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: 2 },
            properties: { pixelSize: 180 },
            fields: "pixelSize",
          },
        },
      ],
    },
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("🚀 Gastito — setup de spreadsheet\n");

  if (!SPREADSHEET_ID) {
    console.error("❌ Falta GOOGLE_SHEETS_SPREADSHEET_ID en el .env");
    process.exit(1);
  }
  if (!CREDENTIALS_PATH && !CREDENTIALS_JSON) {
    console.error("❌ Falta GOOGLE_APPLICATION_CREDENTIALS o GOOGLE_SERVICE_ACCOUNT_JSON en el .env");
    process.exit(1);
  }

  const auth = buildAuth();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sheets = google.sheets({ version: "v4", auth: auth as any });

  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const existing = spreadsheet.data.sheets ?? [];

  console.log(`📋 Spreadsheet: "${spreadsheet.data.properties?.title}"`);
  const existingNames = existing.map((s) => s.properties?.title).filter(Boolean);
  console.log(`   Hojas existentes: ${existingNames.length ? existingNames.join(", ") : "ninguna"}\n`);

  console.log("📝 Hojas:");
  const gastosId = await getOrCreateSheet(sheets, "GASTOS", existing);
  const configId = await getOrCreateSheet(sheets, "CONFIG", existing);

  console.log("\n⚙️  Configurando GASTOS...");
  await setupGastos(sheets, gastosId);

  console.log("⚙️  Configurando CONFIG...");
  await setupConfig(sheets, configId);

  const totalSubs = Object.values(CATEGORIES).reduce((n, subs) => n + subs.length, 0);
  console.log("\n✅ Setup completo!");
  console.log(`   Columnas GASTOS: ${GASTOS_HEADERS.join(", ")}`);
  console.log(`   Categorías: ${Object.keys(CATEGORIES).length} macro (${totalSubs} subcategorías)`);
  console.log(`\n   Abrí el spreadsheet para verificar:`);
  console.log(`   https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}`);
}

main().catch((e) => {
  console.error("❌ Error en setup:", e instanceof Error ? e.message : e);
  process.exit(1);
});
