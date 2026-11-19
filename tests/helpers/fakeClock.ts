/**
 * Deterministic clock for pacing and retry tests. `sleep` advances time instantly and
 * records the requested pause, so tests assert waits without real delays.
 */
export interface FakeClock {
  now(): number;
  sleep(ms: number): Promise<void>;
  /** Every pause requested through `sleep`, in order. */
  readonly sleeps: number[];
}

export function createFakeClock(startMs = 0): FakeClock {
  let current = startMs;
  const sleeps: number[] = [];
  return {
    now: () => current,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      current += ms;
    },
    sleeps,
  };
}
