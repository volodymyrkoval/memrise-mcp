import { RequestNotNeededError } from '../errors.js';
import type { Now, Sleep } from './transport.js';

/** Politeness gap between request starts; one request in flight per process, or per cache folder with a disk lock. */
export const MIN_REQUEST_GAP_MS = 300;

/** One turn at sending: the previous start it must keep its distance from, held until released. */
export interface PacerSlot {
  /** When the previous request started (epoch ms), or `undefined` when none is known. */
  readonly lastStart: number | undefined;
  recordStart(at: number): Promise<void>;
  /** Always called once, also after a failed task. Never rejects. */
  release(): Promise<void>;
}

/** Where the turn and the last start live: in memory for one process, or on disk shared by several. */
export interface PacerLock {
  acquire(): Promise<PacerSlot>;
}

/** Pacing within this process only: the start time lives in memory. */
export class InProcessPacerLock implements PacerLock {
  #lastStart: number | undefined;

  async acquire(): Promise<PacerSlot> {
    return {
      lastStart: this.#lastStart,
      recordStart: async (at) => {
        this.#lastStart = at;
      },
      release: async () => undefined,
    };
  }
}

export interface PacedRunOptions {
  /**
   * Asked once the turn is held, before the gap: `false` drops the task with `RequestNotNeededError`,
   * recording no start. Lets a caller re-check a cache another process may have filled while it waited.
   */
  stillNeeded?: () => Promise<boolean>;
}

export interface RequestPacerDeps {
  now: Now;
  sleep: Sleep;
  /** Defaults to pacing within this process only. */
  lock?: PacerLock;
}

/**
 * Serialises requests: one task at a time, and at least `MIN_REQUEST_GAP_MS` between starts. Calls
 * in this process queue first; only the head of the queue asks the lock for a turn. This class is
 * the one place that decides how long to wait.
 */
export class RequestPacer {
  readonly #now: Now;
  readonly #sleep: Sleep;
  readonly #lock: PacerLock;
  #tail: Promise<void> = Promise.resolve();

  constructor({ now, sleep, lock = new InProcessPacerLock() }: RequestPacerDeps) {
    this.#now = now;
    this.#sleep = sleep;
    this.#lock = lock;
  }

  async run<T>(task: () => Promise<T>, options: PacedRunOptions = {}): Promise<T> {
    const release = await this.#waitForTurn();
    try {
      return await this.#runInSlot(task, options);
    } finally {
      release();
    }
  }

  async #runInSlot<T>(task: () => Promise<T>, { stillNeeded }: PacedRunOptions): Promise<T> {
    const slot = await this.#lock.acquire();
    try {
      if (stillNeeded !== undefined && !(await stillNeeded())) throw new RequestNotNeededError();
      await this.#waitForGap(slot.lastStart);
      await slot.recordStart(this.#now());
      return await task();
    } finally {
      await slot.release();
    }
  }

  /** Queues behind the previous holder; the returned function hands the turn to the next caller. */
  async #waitForTurn(): Promise<() => void> {
    const previous = this.#tail;
    let release!: () => void;
    this.#tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    return release;
  }

  /** Capped at one gap, so a start recorded in the future (clock skew, a bad state file) never stalls requests. */
  async #waitForGap(lastStart: number | undefined): Promise<void> {
    if (lastStart === undefined) return;
    const wait = Math.min(lastStart + MIN_REQUEST_GAP_MS - this.#now(), MIN_REQUEST_GAP_MS);
    if (wait > 0) await this.#sleep(wait);
  }
}
