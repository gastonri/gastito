/** Measures how long each phase of a request takes, in ms. */
export function createTimings() {
  const start = Date.now();
  let last = start;
  const phases: Record<string, number> = {};
  return {
    /** Closes the phase that started at the previous mark. */
    mark(name: string): void {
      const now = Date.now();
      phases[name] = (phases[name] ?? 0) + (now - last);
      last = now;
    },
    phases(): Record<string, number> {
      return { ...phases };
    },
    total(): number {
      return Date.now() - start;
    },
  };
}
