import { describe, expect, it } from "bun:test";
import { isTimeoutError } from "./gemini";

describe("isTimeoutError", () => {
  it("detects axios timeouts, also wrapped by the client", () => {
    expect(isTimeoutError(new Error("timeout of 12000ms exceeded"))).toBe(true);
    expect(isTimeoutError(new Error("Gemini API Error: timeout of 45000ms exceeded"))).toBe(true);
  });

  it("ignores other errors", () => {
    expect(isTimeoutError(new Error("Gemini API Error: 503"))).toBe(false);
    expect(isTimeoutError("timeout")).toBe(false);
  });
});
