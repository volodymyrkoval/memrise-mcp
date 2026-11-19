import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['tests/setup/noNetwork.ts'],
    // Real child processes and real timers: run on their own with `npm run test:realfs`.
    exclude: [...configDefaults.exclude, 'tests/realfs/**'],
  },
});
