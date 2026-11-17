import type { AiFailure, AiRun, AiSlot, FailureReason } from "../ai/attempts";
import { escapeMarkdown } from "../utils/format";

const NOTICE_REASON: Record<FailureReason, string> = {
  timeout: "Gemini no respondió",
  rate_limit: "Se agotó el cupo",
  server_error: "Gemini está con mucha demanda",
  model_unavailable: "El modelo no está disponible",
};

const SHORT_REASON: Record<FailureReason, string> = {
  timeout: "sin respuesta",
  rate_limit: "sin cupo",
  server_error: "con demanda",
  model_unavailable: "no disponible",
};

function describeFailure(f: AiFailure): string {
  return `${escapeMarkdown(f.model)} (${escapeMarkdown(f.keyLabel)}, ${SHORT_REASON[f.reason]})`;
}

/** Failures without repeats (an audio runs two AI calls that can hit the same slot). */
function uniqueFailures(failures: AiFailure[]): AiFailure[] {
  const seen = new Set<string>();
  return failures.filter((f) => {
    const key = `${f.model}|${f.keyLabel}|${f.reason}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Text shown on the loading message while the bot switches model or key. Null: nothing to say. */
export function switchNotice(failure: AiFailure, next: AiSlot | null): string | null {
  if (!next) return null;
  const target =
    next.model === failure.model
      ? `la ${escapeMarkdown(next.keyLabel)}`
      : `${escapeMarkdown(next.model)} (${escapeMarkdown(next.keyLabel)})`;
  return `🔁 ${NOTICE_REASON[failure.reason]}, probando con ${target}...`;
}

/** Line added under the confirmation, only when something failed before it worked. */
export function runFooter(run: AiRun): string {
  if (run.failures.length === 0 || !run.used) return "";
  const used = `${escapeMarkdown(run.used.model)} (${escapeMarkdown(run.used.keyLabel)})`;
  const before = uniqueFailures(run.failures).map(describeFailure).join("; ");
  return `🔁 Respondió ${used}. Antes falló: ${before}.`;
}

/** Line added to an error message, listing what was tried. */
export function runDetail(run: AiRun): string {
  if (run.failures.length === 0) return "";
  return `🔁 Probé: ${uniqueFailures(run.failures).map(describeFailure).join("; ")}.`;
}
