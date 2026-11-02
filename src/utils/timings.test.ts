import { describe, expect, it } from "bun:test";
import { createTimings } from "./timings";

describe("createTimings", () => {
  it("accumulates phases and total", async () => {
    const t = createTimings();
    await new Promise((r) => setTimeout(r, 15));
    t.mark("ai");
    await new Promise((r) => setTimeout(r, 15));
    t.mark("save");
    const phases = t.phases();
    expect(phases.ai).toBeGreaterThanOrEqual(10);
    expect(phases.save).toBeGreaterThanOrEqual(10);
    expect(t.total()).toBeGreaterThanOrEqual(phases.ai + phases.save);
  });
});
