import { describe, expect, test } from "bun:test";
import { parseMontoAR } from "./numbers";

describe("parseMontoAR", () => {
  test("Argentine formats", () => {
    expect(parseMontoAR("1.500")).toBe(1500);
    expect(parseMontoAR("12.500,50")).toBe(12500.5);
    expect(parseMontoAR("$ 1.234,56")).toBe(1234.56);
    expect(parseMontoAR("1.234.567")).toBe(1234567);
    expect(parseMontoAR("1,5")).toBe(1.5);
  });

  test("plain and english-style numbers", () => {
    expect(parseMontoAR("4500")).toBe(4500);
    expect(parseMontoAR("1500.50")).toBe(1500.5);
    expect(parseMontoAR("1,234,567.89")).toBe(1234567.89);
  });

  test("finds the first number inside text", () => {
    expect(parseMontoAR("gasté 1.500 en el kiosco")).toBe(1500);
  });

  test("invalid input", () => {
    expect(parseMontoAR("sin números")).toBeNull();
    expect(parseMontoAR("0")).toBeNull();
    expect(parseMontoAR(undefined)).toBeNull();
    expect(parseMontoAR(2500)).toBe(2500);
  });
});
