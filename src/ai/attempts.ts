import { AsyncLocalStorage } from "node:async_hooks";
import { config } from "../config";

export type FailureReason = "timeout" | "rate_limit" | "server_error" | "model_unavailable";

/** One model on one API key, described the way the user knows it ("cuenta respaldo"). */
export interface AiSlot {
  model: string;
  keyLabel: string;
}

export interface AiFailure extends AiSlot {
  reason: FailureReason;
}

/** What happened to the AI calls of a single Telegram message. */
export interface AiRun {
  failures: AiFailure[];
  used: AiSlot | null;
  /** Called when a slot fails; `next` is where the client goes now (null if nothing is left). */
  onSwitch?: (failure: AiFailure, next: AiSlot | null) => void;
}

/** Carries the run through the async call chain, so the AI clients need no extra parameter. */
export const aiRunStorage = new AsyncLocalStorage<AiRun>();

export function createAiRun(): AiRun {
  return { failures: [], used: null };
}

/** "cuenta principal" for key 1 etc. (GEMINI_KEY_LABELS), falling back to "key 1". */
export function keyLabel(index: number): string {
  return config.ai.gemini.keyLabels[index] || `key ${index + 1}`;
}

export function recordFailure(failure: AiFailure, next: AiSlot | null): void {
  const run = aiRunStorage.getStore();
  if (!run) return;
  run.failures.push(failure);
  try {
    run.onSwitch?.(failure, next);
  } catch {
    // A notification problem must never break the AI call itself.
  }
}

export function recordSuccess(slot: AiSlot): void {
  const run = aiRunStorage.getStore();
  if (run) run.used = slot;
}
