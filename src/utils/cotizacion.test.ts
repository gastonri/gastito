import { describe, expect, test } from "bun:test";
import { parseCotizacionRows, pickCotizacion } from "./cotizacion";

const rows = parseCotizacionRows([
  ["fecha", "precio"],
  ["5/6/2026 9:16:21", "1891.5"],
  ["4/6/2026 12:17:13", "1898"],
  ["6/6/2026 8:58:15", "1.885,5"],
  ["basura", "x"],
]);

describe("cotizacion", () => {
  test("parses, skips header/garbage and sorts", () => {
    expect(rows.map((r) => r.precio)).toEqual([1898, 1891.5, 1885.5]);
  });

  test("uses the rate of the same day", () => {
    expect(pickCotizacion(rows, new Date(2026, 5, 5))).toBe(1891.5);
  });

  test("uses the latest previous rate when there is no entry that day", () => {
    expect(pickCotizacion(rows, new Date(2026, 5, 20))).toBe(1885.5);
  });

  test("falls back to the earliest rate for older dates", () => {
    expect(pickCotizacion(rows, new Date(2026, 0, 1))).toBe(1898);
  });

  test("returns null with no data", () => {
    expect(pickCotizacion([], new Date())).toBeNull();
  });
});
