import { defineConfig } from 'vitest/config';

/** `npm run test:realfs`: real temp folders, real child processes, real timers; never the network. */
export default defineConfig({
  test: {
    include: ['tests/realfs/**/*.test.ts'],
    setupFiles: ['tests/setup/noNetwork.ts'],
    // One file at a time, so timing assertions do not compete with each other for the CPU.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 30_000,
  },
});
