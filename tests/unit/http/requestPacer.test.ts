import { describe, expect, it } from 'vitest';
import { RequestNotNeededError } from '../../../src/errors.js';
import { RequestPacer, type PacerLock } from '../../../src/http/requestPacer.js';
import { createFakeClock } from '../../helpers/fakeClock.js';

describe('RequestPacer', () => {
  it('runs concurrent requests one at a time, at least the minimum gap apart', async () => {
    const clock = createFakeClock();
    const pacer = new RequestPacer({ now: clock.now, sleep: clock.sleep });
    const starts: number[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const task = async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      starts.push(clock.now());
      await Promise.resolve();
      inFlight -= 1;
      return 'done';
    };

    await Promise.all([pacer.run(task), pacer.run(task)]);

    expect(maxInFlight).toBe(1);
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(300);
  });

  it('hands the turn to the next request even when the previous one fails', async () => {
    const clock = createFakeClock();
    const pacer = new RequestPacer({ now: clock.now, sleep: clock.sleep });

    const failed = pacer.run(async () => {
      throw new Error('boom');
    });
    const next = pacer.run(async () => 'recovered');

    await expect(failed).rejects.toThrow('boom');
    await expect(next).resolves.toBe('recovered');
  });

  it('does not pause before a request when the previous one started long ago', async () => {
    const clock = createFakeClock();
    const pacer = new RequestPacer({ now: clock.now, sleep: clock.sleep });
    await pacer.run(async () => 'first');
    await clock.sleep(10_000);
    const pausesBefore = [...clock.sleeps];

    await pacer.run(async () => 'second');

    expect(clock.sleeps).toEqual(pausesBefore);
  });

  it('waits at most one gap, and releases its turn, when the lock reports a start in the future', async () => {
    const clock = createFakeClock(1_000);
    const events: string[] = [];
    const lock: PacerLock = {
      acquire: async () => ({
        lastStart: clock.now() + 60_000,
        recordStart: async (at) => {
          events.push(`start ${at}`);
        },
        release: async () => {
          events.push('release');
        },
      }),
    };

    await new RequestPacer({ now: clock.now, sleep: clock.sleep, lock }).run(async () => 'sent');

    expect(clock.sleeps).toEqual([300]);
    expect(events).toEqual(['start 1300', 'release']);
  });

  it('asks whether a request is still needed once it holds the turn, and a no costs neither the task nor a start', async () => {
    const clock = createFakeClock(1_000);
    const pacer = new RequestPacer({ now: clock.now, sleep: clock.sleep });
    let firstDone = false;
    let firstDoneWhenAsked: boolean | undefined;
    let skippedRan = false;

    const first = pacer.run(async () => {
      await Promise.resolve();
      firstDone = true;
    });
    const skipped = pacer.run(
      async () => {
        skippedRan = true;
      },
      {
        stillNeeded: async () => {
          firstDoneWhenAsked = firstDone;
          return false;
        },
      },
    );

    await first;
    await expect(skipped).rejects.toBeInstanceOf(RequestNotNeededError);
    expect(skippedRan).toBe(false);
    expect(firstDoneWhenAsked).toBe(true);
    expect(clock.sleeps).toEqual([]);
  });
});
