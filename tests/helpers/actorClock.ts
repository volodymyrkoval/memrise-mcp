/**
 * Virtual time shared by several simulated processes ("actors"), each doing one thing at a time.
 * An actor's `sleep` parks it; time only moves once the running actor has parked or finished, and
 * then wakes the actor due first (ties: the lower index). So exactly one actor runs at a time and
 * the interleaving is the same on every run, however long the real file-system calls take.
 */
import type { Now, Sleep } from '../../src/http/transport.js';

export interface ActorClock {
  now: Now;
  sleep: Sleep;
}

interface Parked {
  actor: number;
  wakeAt: number;
  wake: () => void;
}

/** Runs every actor to completion on one virtual clock starting at `startMs`; rejects with the first actor failure. */
export async function runActors(startMs: number, actors: ReadonlyArray<(clock: ActorClock) => Promise<void>>): Promise<void> {
  let current = startMs;
  const parked: Parked[] = [];
  let onIdle: () => void = () => undefined;
  let failure: unknown;
  const now = () => current;

  /** Starts `step` and resolves once the actor it woke has parked again or finished. */
  const runUntilIdle = (step: () => void) =>
    new Promise<void>((resolve) => {
      onIdle = resolve;
      step();
    });

  for (const [actor, body] of actors.entries()) {
    const sleep: Sleep = (ms) =>
      new Promise<void>((wake) => {
        parked.push({ actor, wakeAt: current + ms, wake });
        onIdle();
      });
    await runUntilIdle(() => {
      body({ now, sleep })
        .catch((err: unknown) => {
          failure ??= err;
        })
        .finally(() => onIdle());
    });
  }

  while (parked.length > 0) {
    parked.sort((a, b) => a.wakeAt - b.wakeAt || a.actor - b.actor);
    const next = parked.shift()!;
    current = Math.max(current, next.wakeAt);
    await runUntilIdle(next.wake);
  }
  if (failure !== undefined) throw failure;
}
