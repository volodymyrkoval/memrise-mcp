/**
 * Vitest setup file: replaces global fetch so an unmocked network call in a
 * unit test fails immediately. HTTP tests inject their own transport instead.
 */
function refuseNetwork(): Promise<never> {
  return Promise.reject(new Error('network disabled in unit tests'));
}

globalThis.fetch = refuseNetwork as unknown as typeof fetch;
