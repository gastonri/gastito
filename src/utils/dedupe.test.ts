import { describe, expect, it } from "bun:test";
import { RecentSet } from "./dedupe";

describe("RecentSet", () => {
  it("detects a repeated key", () => {
    const set = new RecentSet();
    expect(set.has(1)).toBe(false);
    expect(set.has(1)).toBe(true);
    expect(set.has(2)).toBe(false);
  });

  it("forgets keys after the ttl", () => {
    const set = new RecentSet(1000);
    expect(set.has(1, 0)).toBe(false);
    expect(set.has(1, 2000)).toBe(false);
  });
});
