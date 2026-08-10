import { google, sheets_v4 } from "googleapis";
import { config } from "../config";
import { Logger } from "../utils/logger";
import { SheetsAPIError } from "../utils/errors";
import { parseDate } from "../services/validator";
import { extractTextWithoutEmoji, getErrorMessage } from "../utils/text";
import { MONTH_NAMES_ES } from "../utils/months";

/**
 * Formats a Date object as DD/MM/YYYY string for Google Sheets
 */
function formatDateForSheets(date: Date): string {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}
import { CategoryMap, ConfigData, TransactionData, GoogleSheetsSpreadsheet } from "../types";

export class SheetsClient {
  private auth: InstanceType<typeof google.auth.GoogleAuth> | null = null;
  private sheets: sheets_v4.Sheets | null = null;
  private spreadsheetId: string;

  constructor() {
    this.spreadsheetId = config.sheets.spreadsheetId;
    void this.initializeAuth();
  }

  private initializeAuth(): void {
    try {
      // Try to use service account credentials
      if (config.sheets.credentialsPath) {
        this.auth = new google.auth.GoogleAuth({
          keyFile: config.sheets.credentialsPath,
          scopes: ["https://www.googleapis.com/auth/spreadsheets"],
        });
      } else {
        // Fallback to environment variable credentials (JSON string)
        const credentialsJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
        if (credentialsJson) {
          const credentials = JSON.parse(credentialsJson) as Record<string, unknown>;
          this.auth = new google.auth.GoogleAuth({
            credentials,
            scopes: ["https://www.googleapis.com/auth/spreadsheets"],
          });
        } else {
          throw new Error(
            "Google Sheets credentials not configured. Set GOOGLE_APPLICATION_CREDENTIALS or GOOGLE_SERVICE_ACCOUNT_JSON"
          );
        }
      }

      if (!this.auth) {
        throw new Error("Auth not initialized");
      }
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
      this.sheets = google.sheets({ version: "v4", auth: this.auth as any });
      Logger.log("Google Sheets client initialized");
    } catch (error) {
      Logger.error("Error initializing Google Sheets client", error);
      throw new SheetsAPIError(`Failed to initialize Sheets client: ${getErrorMessage(error)}`);
    }
  }

  async getConfig(): Promise<ConfigData> {
    if (!this.sheets) {
      throw new SheetsAPIError("Sheets client not initialized");
    }
    try {
      const sheetName = "CONFIG";
      const lastRow = await this.getLastRow(sheetName);

      // Read macro categories (column A)
      const macroRange = `${sheetName}!A2:A${lastRow}`;
      const macroResponse = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: macroRange,
      });
      const macroCategorias = ((macroResponse.data.values as unknown[][]) || [])
        .flat()
        .filter((v): v is string => typeof v === "string" && v !== "");

      // Read subcategories (column B)
      const subRange = `${sheetName}!B2:B${lastRow}`;
      const subResponse = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: subRange,
      });
      const subcategorias = ((subResponse.data.values as unknown[][]) || [])
        .flat()
        .filter((v): v is string => typeof v === "string" && v !== "");

      const categoriasMap = await this.createCategoryMap(sheetName, lastRow);

      return {
        macroCategorias,
        subcategorias,
        categoriasMap,
      };
    } catch (error) {
      Logger.error("Error reading config from Sheets", error);
      throw new SheetsAPIError(`Failed to read config: ${getErrorMessage(error)}`);
    }
  }

  async createCategoryMap(sheetName: string, lastRow: number): Promise<CategoryMap> {
    if (!this.sheets) {
      throw new SheetsAPIError("Sheets client not initialized");
    }
    try {
      const range = `${sheetName}!A2:B${lastRow}`;
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range,
      });

      const mapa: CategoryMap = {};
      const rows = (response.data.values as unknown[][]) || [];

      for (const row of rows) {
        const macro = row[0] as string;
        const sub = row[1] as string;
        if (macro && sub) {
          if (!mapa[macro]) {
            mapa[macro] = [];
          }
          mapa[macro].push(sub);
        }
      }

      return mapa;
    } catch (error) {
      Logger.error("Error creating category map", error);
      throw new SheetsAPIError(`Failed to create category map: ${getErrorMessage(error)}`);
    }
  }

  async findSubcategoryWithEmoji(subcategoriaSinEmoji: string, sheetName: string): Promise<string> {
    if (!subcategoriaSinEmoji || !this.sheets) return "";

    try {
      const lastRow = await this.getLastRow(sheetName);
      const range = `${sheetName}!B2:B${lastRow}`;
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range,
      });

      const subcategorias = ((response.data.values as unknown[][]) || []).flat() as string[];

      // Exact match first
      for (const subcatConEmoji of subcategorias) {
        if (!subcatConEmoji || typeof subcatConEmoji !== "string") continue;
        const textoLimpio = extractTextWithoutEmoji(subcatConEmoji);
        if (textoLimpio.toLowerCase() === subcategoriaSinEmoji.toLowerCase()) {
          return subcatConEmoji;
        }
      }

      // Partial match
      for (const subcatConEmoji of subcategorias) {
        if (!subcatConEmoji || typeof subcatConEmoji !== "string") continue;
        const textoLimpio = extractTextWithoutEmoji(subcatConEmoji);
        if (
          textoLimpio.toLowerCase().includes(subcategoriaSinEmoji.toLowerCase()) ||
          subcategoriaSinEmoji.toLowerCase().includes(textoLimpio.toLowerCase())
        ) {
          return subcatConEmoji;
        }
      }

      return subcategoriaSinEmoji;
    } catch (error) {
      Logger.error("Error finding subcategory with emoji", error);
      return subcategoriaSinEmoji;
    }
  }

  async findLastRowWithData(sheetName: string): Promise<number> {
    if (!this.sheets) {
      throw new SheetsAPIError("Sheets client not initialized");
    }
    try {
      // Get all values in column A
      const range = `${sheetName}!A:A`;
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range,
      });

      const values = (response.data.values as unknown[][]) || [];

      // Find last non-empty row
      for (let i = values.length - 1; i >= 0; i--) {
        const row = values[i];
        if (row && row[0]) {
          const cellValue = row[0];
          if (typeof cellValue === "string" && cellValue.trim() !== "") {
            return i + 1; // +1 because Sheets is 1-indexed
          }
          if (typeof cellValue === "number" || typeof cellValue === "boolean") {
            return i + 1; // +1 because Sheets is 1-indexed
          }
        }
      }

      return 1; // Header row
    } catch (error) {
      Logger.error("Error finding last row with data", error);
      return 1;
    }
  }

  async writeGasto(data: TransactionData): Promise<void> {
    if (!this.sheets) {
      throw new SheetsAPIError("Sheets client not initialized");
    }
    try {
      const sheetName = "GASTOS";
      const lastRow = await this.findLastRowWithData(sheetName);
      const newRow = lastRow + 1;

      const subcategoriaConEmoji = await this.findSubcategoryWithEmoji(
        data.subcategoria || "",
        "CONFIG"
      );

      let fecha: Date;
      if (typeof data.fecha === "string") {
        const parsedDate = parseDate(data.fecha);
        fecha = parsedDate || new Date();
      } else {
        fecha = new Date();
      }

      const cuotas = parseInt(String(data.cuotas || 1), 10);
      const nCuota = parseInt(String(data.n_cuota || 1), 10);
      const miParte = data.mi_parte !== undefined ? data.mi_parte : 100;

      // Write A:I (fecha through n_cuota)
      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: `${sheetName}!A${newRow}:I${newRow}`,
        valueInputOption: "USER_ENTERED",
        requestBody: {
          values: [
            [
              formatDateForSheets(fecha),
              (data.persona || "").trim(),
              (data.descripcion || "").trim(),
              (data.macro_categoria || "").trim(),
              subcategoriaConEmoji,
              parseFloat(String(data.monto || 0)),
              data.moneda || "ARS",
              String(cuotas),
              String(nCuota),
            ],
          ],
        },
      });

      // Write J:P (imp_mensual through dia)
      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: `${sheetName}!J${newRow}:P${newRow}`,
        valueInputOption: "USER_ENTERED",
        requestBody: {
          values: [
            [
              `=IFERROR(IF(H${newRow}>0,F${newRow}/H${newRow},F${newRow}),"")`,
              String(miParte),
              (data.link || "").trim(),
              (data.notas || "").trim(),
              fecha.getFullYear(),
              fecha.getMonth() + 1,
              fecha.getDate(),
            ],
          ],
        },
      });

      Logger.log(`✅ GASTO written successfully in row ${newRow}`);
    } catch (error) {
      Logger.error("Error writing GASTO to Sheets", error);
      throw new SheetsAPIError(`Failed to write GASTO: ${getErrorMessage(error)}`);
    }
  }

  async writeIngreso(data: TransactionData): Promise<void> {
    if (!this.sheets) {
      throw new SheetsAPIError("Sheets client not initialized");
    }
    try {
      const sheetName = "INGRESOS";
      const lastRow = await this.findLastRowWithData(sheetName);
      const newRow = lastRow + 1;

      let fecha: Date;
      if (typeof data.fecha === "string") {
        const parsedDate = parseDate(data.fecha);
        fecha = parsedDate || new Date();
      } else {
        fecha = new Date();
      }

      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: `${sheetName}!A${newRow}:K${newRow}`,
        valueInputOption: "USER_ENTERED",
        requestBody: {
          values: [
            [
              formatDateForSheets(fecha),
              (data.persona || "").trim(),
              (data.descripcion || "").trim(),
              (data.categoria || "").trim(),
              parseFloat(String(data.monto || 0)),
              data.moneda || "ARS",
              (data.link || "").trim(),
              (data.notas || "").trim(),
              fecha.getFullYear(),
              MONTH_NAMES_ES[fecha.getMonth()],
              fecha.getDate(),
            ],
          ],
        },
      });

      Logger.log(`✅ INGRESO written successfully in row ${newRow}`);
    } catch (error) {
      Logger.error("Error writing INGRESO to Sheets", error);
      throw new SheetsAPIError(`Failed to write INGRESO: ${getErrorMessage(error)}`);
    }
  }

  async getGastosPorDiaDelMes(
    year: number,
    month: number
  ): Promise<{ dia: number; monto: number }[]> {
    if (!this.sheets) {
      throw new SheetsAPIError("Sheets client not initialized");
    }
    try {
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: "GASTOS!A:P",
      });
      const rows = (response.data.values as unknown[][]) || [];
      const byDay = new Map<number, number>();

      for (const row of rows) {
        let rowYear = Number(row[13]);
        let rowMonth = Number(row[14]);
        let rowDay = Number(row[15]);

        if (!rowYear || !rowMonth) {
          const parts = String(row[0] ?? "").split("/");
          if (parts.length === 3) {
            rowDay = Number(parts[0]);
            rowMonth = Number(parts[1]);
            rowYear = Number(parts[2]);
          }
        }

        if (rowYear !== year || rowMonth !== month) continue;
        const monto = parseFloat(String(row[9] ?? "0"));
        if (isNaN(monto) || monto <= 0) continue;

        byDay.set(rowDay, (byDay.get(rowDay) ?? 0) + monto);
      }

      return [...byDay.entries()]
        .map(([dia, monto]) => ({ dia, monto }))
        .sort((a, b) => a.dia - b.dia);
    } catch (error) {
      Logger.error("Error reading GASTOS por dia from Sheets", error);
      throw new SheetsAPIError(`Failed to read GASTOS por dia: ${getErrorMessage(error)}`);
    }
  }

  async getGastosDelMes(
    year: number,
    month: number
  ): Promise<{ macro_categoria: string; monto: number; moneda: string }[]> {
    if (!this.sheets) {
      throw new SheetsAPIError("Sheets client not initialized");
    }
    try {
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: "GASTOS!A:P",
      });
      const rows = (response.data.values as unknown[][]) || [];
      Logger.log(`getGastosDelMes: ${rows.length} rows returned, filtering for ${year}/${month}`);
      if (rows.length > 1) {
        Logger.log(
          `getGastosDelMes sample row[1]: length=${rows[1]?.length}, [0]=${rows[1]?.[0]}, [13]=${rows[1]?.[13]}, [14]=${rows[1]?.[14]}`
        );
      }
      const result: { macro_categoria: string; monto: number; moneda: string }[] = [];
      for (const row of rows) {
        let rowYear = Number(row[13]);
        let rowMonth = Number(row[14]);
        if (!rowYear || !rowMonth) {
          const parts = String(row[0] ?? "").split("/");
          if (parts.length === 3) {
            rowYear = Number(parts[2]);
            rowMonth = Number(parts[1]);
          }
        }
        if (rowYear !== year || rowMonth !== month) continue;
        const monto = parseFloat(String(row[9] ?? "0"));
        if (isNaN(monto) || monto <= 0) continue;
        result.push({
          macro_categoria: String(row[3] ?? "Sin categoría").trim(),
          monto,
          moneda: String(row[6] ?? "ARS").trim(),
        });
      }
      return result;
    } catch (error) {
      Logger.error("Error reading GASTOS from Sheets", error);
      throw new SheetsAPIError(`Failed to read GASTOS: ${getErrorMessage(error)}`);
    }
  }

  /**
   * Reads monthly budgets per category from the PRESUPUESTOS sheet (columns: categoria, monto).
   * Returns an empty array if the sheet doesn't exist yet.
   */
  async getPresupuestos(): Promise<{ macro_categoria: string; monto: number }[]> {
    if (!this.sheets) {
      throw new SheetsAPIError("Sheets client not initialized");
    }
    try {
      const exists = await this.sheetExists("PRESUPUESTOS");
      if (!exists) {
        return [];
      }

      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: "PRESUPUESTOS!A:B",
      });
      const rows = (response.data.values as unknown[][]) || [];
      const result: { macro_categoria: string; monto: number }[] = [];

      for (let i = rows.length > 0 && rows[0]?.[0] === "categoria" ? 1 : 0; i < rows.length; i++) {
        const row = rows[i];
        const cell0 = row?.[0];
        const cell1 = row?.[1];
        const categoria = typeof cell0 === "string" ? cell0.trim() : "";
        const monto =
          typeof cell1 === "number" ? cell1 : parseFloat(typeof cell1 === "string" ? cell1 : "0");
        if (!categoria || isNaN(monto) || monto <= 0) continue;
        result.push({ macro_categoria: categoria, monto });
      }

      return result;
    } catch (error) {
      Logger.error("Error reading PRESUPUESTOS from Sheets", error);
      throw new SheetsAPIError(`Failed to read PRESUPUESTOS: ${getErrorMessage(error)}`);
    }
  }

  /**
   * Reads the net and accumulated balance for a given month from the CUADERNO_CONTABLE
   * sheet (columns: año, mes, numero_mes, ingresos, gastos, neto_mes, acumulado). That
   * sheet computes these values via formulas over GASTOS/INGRESOS, so this just reads
   * the already-computed row. Returns null if the sheet doesn't exist or has no row
   * for that month yet.
   */
  async getCuadernoContableDelMes(
    year: number,
    month: number
  ): Promise<{ neto_mes: number; acumulado: number } | null> {
    if (!this.sheets) {
      throw new SheetsAPIError("Sheets client not initialized");
    }
    try {
      const exists = await this.sheetExists("CUADERNO_CONTABLE");
      if (!exists) {
        return null;
      }

      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: "CUADERNO_CONTABLE!A:G",
      });
      const rows = (response.data.values as unknown[][]) || [];

      for (const row of rows) {
        const rowYear = Number(row[0]);
        const rowNumeroMes = Number(row[2]);
        if (rowYear !== year || rowNumeroMes !== month) continue;

        const netoRaw = String(row[5] ?? "").replace(/[$,\s]/g, "");
        const acumuladoRaw = String(row[6] ?? "").replace(/[$,\s]/g, "");
        const neto_mes = parseFloat(netoRaw);
        const acumulado = parseFloat(acumuladoRaw);
        if (isNaN(neto_mes) || isNaN(acumulado)) return null;

        return { neto_mes, acumulado };
      }

      return null;
    } catch (error) {
      Logger.error("Error reading CUADERNO_CONTABLE from Sheets", error);
      throw new SheetsAPIError(`Failed to read CUADERNO_CONTABLE: ${getErrorMessage(error)}`);
    }
  }

  private async getLastRow(sheetName: string): Promise<number> {
    if (!this.sheets) {
      throw new SheetsAPIError("Sheets client not initialized");
    }
    try {
      const range = `${sheetName}!A:A`;
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range,
      });
      const values = (response.data.values as unknown[][]) || [];
      return values.length > 0 ? values.length + 1 : 2;
    } catch (error) {
      Logger.error(`Error getting last row for ${sheetName}`, error);
      return 2;
    }
  }

  async sheetExists(sheetName: string): Promise<boolean> {
    if (!this.sheets) {
      return false;
    }
    try {
      const response = await this.sheets.spreadsheets.get({
        spreadsheetId: this.spreadsheetId,
      });
      const sheets = (response.data.sheets as GoogleSheetsSpreadsheet["sheets"]) || [];
      return sheets.some((sheet) => sheet?.properties?.title === sheetName);
    } catch (error) {
      Logger.error("Error checking if sheet exists", error);
      return false;
    }
  }

  /**
   * Get the AI provider preference for a user from USER_PREFERENCES sheet
   */
  async getUserAIProvider(chatId: number): Promise<string | null> {
    if (!this.sheets) {
      return null;
    }
    const sheetName = "USER_PREFERENCES";
    try {
      const exists = await this.sheetExists(sheetName);
      if (!exists) {
        return null;
      }

      const range = `${sheetName}!A:B`;
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range,
      });

      const values = (response.data.values as unknown[][]) || [];

      // Skip header row (if exists)
      for (
        let i = values.length > 0 && values[0]?.[0] === "chatId" ? 1 : 0;
        i < values.length;
        i++
      ) {
        const row = values[i];
        const cell0 = row?.[0];
        if (
          row &&
          (typeof cell0 === "string" || typeof cell0 === "number") &&
          String(cell0) === String(chatId)
        ) {
          const cell1 = row?.[1];
          return (typeof cell1 === "string" || typeof cell1 === "number" ? String(cell1) : "")
            .toLowerCase()
            .trim();
        }
      }

      return null;
    } catch (error) {
      Logger.error("Error reading AI provider from Sheets", error);
      return null;
    }
  }

  /**
   * Set the AI provider preference for a user in USER_PREFERENCES sheet
   */
  async setUserAIProvider(chatId: number, provider: string): Promise<void> {
    if (!this.sheets) {
      throw new SheetsAPIError("Sheets client not initialized");
    }
    const sheetName = "USER_PREFERENCES";
    try {
      const exists = await this.sheetExists(sheetName);
      if (!exists) {
        // Create the sheet with headers
        await this.sheets.spreadsheets.batchUpdate({
          spreadsheetId: this.spreadsheetId,
          requestBody: {
            requests: [
              {
                addSheet: {
                  properties: {
                    title: sheetName,
                  },
                },
              },
            ],
          },
        });

        // Add headers
        await this.sheets.spreadsheets.values.update({
          spreadsheetId: this.spreadsheetId,
          range: `${sheetName}!A1:B1`,
          valueInputOption: "USER_ENTERED",
          requestBody: {
            values: [["chatId", "ai_provider"]],
          },
        });
      }

      // Check if user preference already exists
      const range = `${sheetName}!A:B`;
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range,
      });

      const values = (response.data.values as unknown[][]) || [];
      let userRowIndex = -1;

      // Skip header row
      for (
        let i = values.length > 0 && values[0]?.[0] === "chatId" ? 1 : 0;
        i < values.length;
        i++
      ) {
        const row = values[i];
        const cell0 = row?.[0];
        if (
          row &&
          (typeof cell0 === "string" || typeof cell0 === "number") &&
          String(cell0) === String(chatId)
        ) {
          userRowIndex = i + 1; // +1 because Sheets is 1-indexed
          break;
        }
      }

      if (userRowIndex > 0) {
        // Update existing row
        await this.sheets.spreadsheets.values.update({
          spreadsheetId: this.spreadsheetId,
          range: `${sheetName}!B${userRowIndex}`,
          valueInputOption: "USER_ENTERED",
          requestBody: {
            values: [[provider]],
          },
        });
      } else {
        // Add new row
        const lastRow = values.length + 1;
        await this.sheets.spreadsheets.values.update({
          spreadsheetId: this.spreadsheetId,
          range: `${sheetName}!A${lastRow}:B${lastRow}`,
          valueInputOption: "USER_ENTERED",
          requestBody: {
            values: [[String(chatId), provider]],
          },
        });
      }
    } catch (error) {
      Logger.error("Error writing AI provider to Sheets", error);
      throw new SheetsAPIError(`Failed to write AI provider: ${getErrorMessage(error)}`);
    }
  }
}
