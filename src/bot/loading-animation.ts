import { TelegramClient } from "./telegram";

const FRAME_INTERVAL_MS = 1500;
const MAX_FRAMES = 40; // stop editing after ~1 minute

type Editor = Pick<TelegramClient, "editMessage">;

/** "Procesando..." -> ["Procesando.", "Procesando..", "Procesando..."]. */
export function loadingFrames(text: string): string[] {
  const base = text.replace(/\.+$/, "");
  return [`${base}.`, `${base}..`, `${base}...`];
}

/**
 * Animates the dots of a "loading" message by editing it periodically.
 * Returns a stop function that waits for any in-flight edit, so a later edit
 * (the confirmation) can never be overwritten by a stale frame.
 */
export function animateLoading(
  client: Editor,
  chatId: number,
  messageId: number,
  text: string,
  intervalMs = FRAME_INTERVAL_MS
): () => Promise<void> {
  const frames = loadingFrames(text);
  let tick = 0;
  let stopped = false;
  let inFlight: Promise<void> = Promise.resolve();

  const timer = setInterval(() => {
    if (stopped || tick >= MAX_FRAMES) return;
    const frame = frames[tick % frames.length];
    tick++;
    // The first frame equals the initial text's dots count only by chance; Telegram rejects
    // identical edits, and editMessage already swallows that error.
    inFlight = inFlight.then(() => client.editMessage(chatId, messageId, frame).catch(() => {}));
  }, intervalMs);

  return async () => {
    stopped = true;
    clearInterval(timer);
    await inFlight;
  };
}
