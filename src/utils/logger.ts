export class Logger {
  static log(message: string, ...args: unknown[]): void {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${message}`, ...args);
  }

  static error(message: string, error?: unknown): void {
    const timestamp = new Date().toISOString();
    console.error(`[${timestamp}] ERROR: ${message}`);
    if (error instanceof Error) {
      console.error(`[${timestamp}] Stack:`, error.stack);
    } else if (error) {
      console.error(`[${timestamp}] Error details:`, error);
    }
  }

  static warn(message: string, ...args: unknown[]): void {
    const timestamp = new Date().toISOString();
    console.warn(`[${timestamp}] WARN: ${message}`, ...args);
  }

  /**
   * One-line structured event for searching in the logs, e.g.
   * `EVENT gemini_call model=x ms=1200 status=200`. Never pass message text or secrets.
   */
  static event(
    name: string,
    fields: Record<string, string | number | boolean | undefined> = {}
  ): void {
    const parts = Object.entries(fields)
      .filter(([, v]) => v !== undefined && v !== "")
      .map(([k, v]) => `${k}=${String(v).replace(/\s+/g, "_")}`);
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] EVENT ${name} ${parts.join(" ")}`.trimEnd());
  }
}
