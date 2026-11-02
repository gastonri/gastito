import { describe, expect, it } from "bun:test";
import { toUserMessage } from "./error-handler";
import { Messages } from "./messages";

const gemini = (body: string) => new Error(`Gemini API Error: ${body}`);

describe("toUserMessage", () => {
  it("explains high demand (503)", () => {
    const err = gemini(
      '{"code":503,"message":"This model is currently experiencing high demand.","status":"UNAVAILABLE"}'
    );
    expect(toUserMessage(err)).toBe(Messages.aiHighDemand);
  });

  it("explains a model that is no longer available (404)", () => {
    const err = gemini(
      '{"code":404,"message":"This model models/x is no longer available to new users.","status":"NOT_FOUND"}'
    );
    expect(toUserMessage(err)).toBe(Messages.aiModelUnavailable);
  });

  it("explains an invalid API key", () => {
    const err = gemini('{"code":400,"message":"API key not valid.","status":"UNAUTHENTICATED"}');
    expect(toUserMessage(err)).toBe(Messages.aiModelUnavailable);
  });

  it("keeps quota errors separate", () => {
    expect(toUserMessage(gemini('{"code":429,"status":"RESOURCE_EXHAUSTED"}'))).toBe(
      Messages.quotaExceeded
    );
  });

  it("falls back to the generic AI message", () => {
    expect(toUserMessage(gemini("No text in response"))).toBe(Messages.aiUnavailable);
  });
});
