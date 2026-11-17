import { describe, expect, it } from "bun:test";
import type { AiFailure, AiRun } from "../ai/attempts";
import { runDetail, runFooter, switchNotice } from "./ai-run-notices";

const principal = (model: string, reason: AiFailure["reason"]): AiFailure => ({
  model,
  keyLabel: "cuenta principal",
  reason,
});

describe("switchNotice", () => {
  it("names the other account when only the key changes", () => {
    const notice = switchNotice(principal("gemini-3.6-flash", "timeout"), {
      model: "gemini-3.6-flash",
      keyLabel: "cuenta respaldo",
    });
    expect(notice).toBe("🔁 Gemini no respondió, probando con la cuenta respaldo...");
  });

  it("names the model when the model changes", () => {
    const notice = switchNotice(principal("gemini-3.6-flash", "rate_limit"), {
      model: "gemini-3.8-flash",
      keyLabel: "cuenta principal",
    });
    expect(notice).toBe("🔁 Se agotó el cupo, probando con gemini-3.8-flash (cuenta principal)...");
  });

  it("says nothing when there is nowhere left to go", () => {
    expect(switchNotice(principal("gemini-2.5-flash", "timeout"), null)).toBeNull();
  });
});

describe("runFooter and runDetail", () => {
  const run = (failures: AiFailure[], used: AiRun["used"]): AiRun => ({ failures, used });

  it("adds nothing when the first try worked", () => {
    const ok = run([], { model: "gemini-3.6-flash", keyLabel: "cuenta principal" });
    expect(runFooter(ok)).toBe("");
    expect(runDetail(ok)).toBe("");
  });

  it("explains what failed before the answer", () => {
    const r = run([principal("gemini-3.6-flash", "timeout")], {
      model: "gemini-3.8-flash",
      keyLabel: "cuenta principal",
    });
    expect(runFooter(r)).toBe(
      "🔁 Respondió gemini-3.8-flash (cuenta principal). Antes falló: gemini-3.6-flash (cuenta principal, sin respuesta)."
    );
  });

  it("lists every attempt once when everything failed", () => {
    const failure = principal("gemini-3.6-flash", "timeout");
    const r = run([failure, failure, principal("gemini-3.8-flash", "rate_limit")], null);
    expect(runFooter(r)).toBe("");
    expect(runDetail(r)).toBe(
      "🔁 Probé: gemini-3.6-flash (cuenta principal, sin respuesta); gemini-3.8-flash (cuenta principal, sin cupo)."
    );
  });
});
