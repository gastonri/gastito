import { describe, expect, it } from "bun:test";
import { animateLoading, loadingFrames } from "./loading-animation";

describe("loading animation", () => {
  it("builds frames from the message text", () => {
    expect(loadingFrames("💬 Procesando...")).toEqual([
      "💬 Procesando.",
      "💬 Procesando..",
      "💬 Procesando...",
    ]);
  });

  it("edits the message until stopped and never after", async () => {
    const edits: string[] = [];
    const client = {
      editMessage: async (_c: number, _m: number, text: string) => {
        edits.push(text);
      },
    };
    const stop = animateLoading(client, 1, 2, "Procesando...", 5);
    await new Promise((r) => setTimeout(r, 30));
    await stop();
    const count = edits.length;
    expect(count).toBeGreaterThan(1);
    await new Promise((r) => setTimeout(r, 30));
    expect(edits.length).toBe(count);
  });
});
