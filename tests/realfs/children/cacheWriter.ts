/**
 * Child process for the shared-cache test: rewrites the same lesson-details entry and the session
 * file `rounds` times, reading the entry back each time. Args: <cache dir> <label> <rounds>.
 */
import { DiskScenarioDetailsStore } from '../../../src/cache/diskScenarioDetailsStore.js';
import type { ScenarioDetails } from '../../../src/domain/types.js';
import { FileSessionStore } from '../../../src/session/fileSessionStore.js';
import { failOnWarnLogger, runChild } from './childSupport.js';

const SHARED_LESSON_ID = 1001;

function detailsFor(label: string, round: number): ScenarioDetails {
  return {
    scenarioId: SHARED_LESSON_ID,
    learnables: Array.from({ length: 40 }, (_, i) => ({
      id: i + 1,
      target: `${label} word ${round}-${i}`,
      source: `meaning ${i}`,
      growthLevel: round % 7,
      alreadyKnown: false,
      difficult: i % 2 === 0,
    })),
    completed: true,
    dateStarted: null,
    dateCompleted: null,
  };
}

runChild(async () => {
  const [cacheDir, label, rounds] = process.argv.slice(2);
  const details = new DiskScenarioDetailsStore({ cacheDir, now: Date.now, logger: failOnWarnLogger });
  const sessions = new FileSessionStore({ cacheDir, account: 'shared-account', now: Date.now, logger: failOnWarnLogger });
  for (let round = 0; round < Number(rounds); round += 1) {
    await details.write(SHARED_LESSON_ID, detailsFor(label, round));
    await sessions.save({ accessToken: `${label}-${round}` });
    if ((await details.read(SHARED_LESSON_ID)) === null) throw new Error(`round ${round}: the entry read back as missing`);
  }
  process.stdout.write('done\n');
});
