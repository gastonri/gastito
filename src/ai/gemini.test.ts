import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import axios from "axios";
import { config } from "../config";
import { GeminiAPIError } from "../utils/errors";
import { aiRunStorage, createAiRun } from "./attempts";
import { GeminiClient, isServerError, isTimeoutError, selectKeyIndex } from "./gemini";

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

describe("isServerError", () => {
  it("treats 5xx Gemini errors as retryable with another key", () => {
    expect(isServerError(new GeminiAPIError("overloaded", 503))).toBe(true);
    expect(isServerError(new GeminiAPIError("boom", 500))).toBe(true);
  });

  it("ignores client errors and unrelated errors", () => {
    expect(isServerError(new GeminiAPIError("bad request", 400))).toBe(false);
    expect(isServerError(new GeminiAPIError("no status"))).toBe(false);
    expect(isServerError(new Error("503"))).toBe(false);
  });
});

describe("selectKeyIndex", () => {
  const none = new Map<number, number>();

  it("uses keys in order", () => {
    expect(selectKeyIndex(3, new Set(), none, none, 1000)).toBe(0);
    expect(selectKeyIndex(3, new Set([0]), none, none, 1000)).toBe(1);
  });

  it("skips rate limited keys until their cooldown ends", () => {
    const limited = new Map([[0, 5000]]);
    expect(selectKeyIndex(2, new Set(), limited, none, 1000)).toBe(1);
    expect(selectKeyIndex(2, new Set(), limited, none, 6000)).toBe(0);
  });

  it("puts a recently timed out key last instead of first", () => {
    const slow = new Map([[0, 5000]]);
    expect(selectKeyIndex(3, new Set(), none, slow, 1000)).toBe(1);
    expect(selectKeyIndex(3, new Set([1, 2]), none, slow, 1000)).toBe(0);
  });

  it("returns null when every key was tried or is rate limited", () => {
    expect(selectKeyIndex(2, new Set([0, 1]), none, none, 1000)).toBeNull();
    const limited = new Map([
      [0, 5000],
      [1, 5000],
    ]);
    expect(selectKeyIndex(2, new Set(), limited, none, 1000)).toBeNull();
  });
});

describe("GeminiClient model rotation", () => {
  const apiError = (status: number) =>
    Object.assign(new Error(`HTTP ${status}`), {
      isAxiosError: true,
      response: { status, data: { error: { message: `status ${status}` } } },
    });
  const ok = (text: string) => ({
    status: 200,
    data: { candidates: [{ content: { parts: [{ text }] } }] },
  });

  const setup = (responses: Array<unknown>) => {
    config.ai.gemini.apiKeys = ["k1", "k2"];
    config.ai.gemini.modelNames = ["model-a", "model-b"];
    config.ai.gemini.thinkingLevel = "";
    const urls: string[] = [];
    const queue = [...responses];
    spyOn(axios, "post").mockImplementation((url: string) => {
      urls.push(url);
      const next = queue.shift();
      return next instanceof Error ? Promise.reject(next) : Promise.resolve(next as never);
    });
    return { client: new GeminiClient(), urls };
  };

  afterEach(() => mock.restore());

  it("tries every key on the first model before moving to the next model", async () => {
    const { client, urls } = setup([apiError(429), apiError(429), ok("from b")]);
    expect(await client.generateContent("hi")).toBe("from b");
    expect(urls.map((u) => u.match(/models\/([^:]+)/)?.[1])).toEqual([
      "model-a",
      "model-a",
      "model-b",
    ]);
    expect(urls[0]).toContain("key=k1");
    expect(urls[1]).toContain("key=k2");
    expect(urls[2]).toContain("key=k1");
  });

  it("skips a model that answers 404 on every key", async () => {
    const { client, urls } = setup([apiError(404), ok("from b")]);
    expect(await client.generateContent("hi")).toBe("from b");
    expect(urls).toHaveLength(2);
    expect(urls[1]).toContain("models/model-b");
  });

  it("moves on to the next slot after a 503", async () => {
    const { client, urls } = setup([apiError(503), ok("second key")]);
    expect(await client.generateContent("hi")).toBe("second key");
    expect(urls[1]).toContain("key=k2");
  });

  const timeoutError = () =>
    Object.assign(new Error("timeout of 12000ms exceeded"), {
      isAxiosError: true,
      code: "ECONNABORTED",
    });

  it("skips the other keys of a model that timed out and goes to the next model", async () => {
    const { client, urls } = setup([timeoutError(), ok("from b")]);
    expect(await client.generateContent("hi")).toBe("from b");
    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain("models/model-a");
    expect(urls[1]).toContain("models/model-b");
  });

  it("tells the run which slots failed and which one answered", async () => {
    const { client } = setup([timeoutError(), ok("from b")]);
    const run = createAiRun();
    const notices: Array<string | null> = [];
    run.onSwitch = (_failure, next) => notices.push(next ? `${next.model}/${next.keyLabel}` : null);
    await aiRunStorage.run(run, () => client.generateContent("hi"));
    expect(run.failures).toEqual([{ model: "model-a", keyLabel: "key 1", reason: "timeout" }]);
    expect(run.used).toEqual({ model: "model-b", keyLabel: "key 1" });
    expect(notices).toEqual(["model-b/key 1"]);
  });

  it("works without a run (other callers, scripts)", async () => {
    const { client } = setup([ok("plain")]);
    expect(await client.generateContent("hi")).toBe("plain");
  });
});
