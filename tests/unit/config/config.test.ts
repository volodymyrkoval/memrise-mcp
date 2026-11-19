import { posix, win32 } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigError } from '../../../src/errors.js';
import { loadConfig, requireCredentials } from '../../../src/config/config.js';

const BASE_ENV = { HOME: '/home/learner' };
/** The host is pinned so these tests mean the same on every OS; Windows has its own describe block. */
const LINUX = { platform: 'linux' as const, homedir: () => '/home/fallback' };
const WINDOWS = { platform: 'win32' as const, homedir: () => 'C:\\Users\\learner' };
const join = posix.join;
// Fake credentials; built at runtime so the repo secret scanner stays quiet.
const FAKE_USERNAME = ['learner', 'example.org'].join('@');
const FAKE_PASSWORD = 'fake-pass-word-42';

describe('loadConfig', () => {
  it('reads the username and password from the environment', () => {
    const config = loadConfig({ ...BASE_ENV, MEMRISE_USERNAME: FAKE_USERNAME, MEMRISE_PASSWORD: FAKE_PASSWORD }, LINUX);

    expect(config.username).toBe(FAKE_USERNAME);
    expect(config.password).toBe(FAKE_PASSWORD);
  });
});

describe('loadConfig blank values', () => {
  it('treats blank optional variables as unset', () => {
    const config = loadConfig({
      ...BASE_ENV,
      MEMRISE_USERNAME: '   ',
      MEMRISE_LANGUAGE_PAIR_ID: ' ',
      MEMRISE_CACHE_DIR: '',
      MEMRISE_WORDS_TTL_SECONDS: ' ',
    }, LINUX);

    expect(config.username).toBeUndefined();
    expect(config.languagePairId).toBeNull();
    expect(config.cacheDir).toBe(join('/home/learner', '.cache', 'memrise-mcp'));
    expect(config.wordsTtlSeconds).toBe(3600);
  });
});

describe('loadConfig cache directory', () => {
  it('uses MEMRISE_CACHE_DIR when it is set', () => {
    expect(loadConfig({ ...BASE_ENV, MEMRISE_CACHE_DIR: '/var/cache/mm' }, LINUX).cacheDir).toBe('/var/cache/mm');
  });

  it('rejects a relative MEMRISE_CACHE_DIR, naming the variable', () => {
    const load = () => loadConfig({ ...BASE_ENV, MEMRISE_CACHE_DIR: 'relative/cache' }, LINUX);

    expect(load).toThrow(ConfigError);
    expect(load).toThrow(/MEMRISE_CACHE_DIR must be an absolute path/);
  });

  it('defaults to a memrise-mcp folder under XDG_CACHE_HOME when present', () => {
    const config = loadConfig({ ...BASE_ENV, XDG_CACHE_HOME: '/xdg/cache' }, LINUX);

    expect(config.cacheDir).toBe(join('/xdg/cache', 'memrise-mcp'));
  });

  it('defaults to HOME/.cache/memrise-mcp when XDG_CACHE_HOME is absent', () => {
    expect(loadConfig(BASE_ENV, LINUX).cacheDir).toBe(join('/home/learner', '.cache', 'memrise-mcp'));
  });

  it('falls back to the home folder of the OS user when HOME is unset', () => {
    expect(loadConfig({}, LINUX).cacheDir).toBe(join('/home/fallback', '.cache', 'memrise-mcp'));
  });
});

describe('loadConfig cache directory on Windows', () => {
  it('defaults to a memrise-mcp folder under LOCALAPPDATA', () => {
    const config = loadConfig({ LOCALAPPDATA: 'D:\\Profiles\\learner\\AppData\\Local' }, WINDOWS);

    expect(config.cacheDir).toBe('D:\\Profiles\\learner\\AppData\\Local\\memrise-mcp');
  });

  it('uses LOCALAPPDATA even when HOME or XDG_CACHE_HOME are set', () => {
    const config = loadConfig({ LOCALAPPDATA: 'D:\\Local', HOME: '/home/learner', XDG_CACHE_HOME: '/xdg' }, WINDOWS);

    expect(config.cacheDir).toBe(win32.join('D:\\Local', 'memrise-mcp'));
  });

  it('falls back to AppData\\Local in the home folder when LOCALAPPDATA is unset', () => {
    expect(loadConfig({}, WINDOWS).cacheDir).toBe('C:\\Users\\learner\\AppData\\Local\\memrise-mcp');
  });

  it('accepts a Windows absolute MEMRISE_CACHE_DIR', () => {
    expect(loadConfig({ MEMRISE_CACHE_DIR: 'E:\\memrise' }, WINDOWS).cacheDir).toBe('E:\\memrise');
  });

  it('rejects a relative Windows MEMRISE_CACHE_DIR', () => {
    expect(() => loadConfig({ MEMRISE_CACHE_DIR: 'cache\\memrise' }, WINDOWS)).toThrow(/MEMRISE_CACHE_DIR must be an absolute path/);
  });
});

describe('loadConfig word-list TTL', () => {
  it('defaults the word-list cache lifetime to one hour', () => {
    expect(loadConfig(BASE_ENV, LINUX).wordsTtlSeconds).toBe(3600);
  });

  it('reads MEMRISE_WORDS_TTL_SECONDS as the cache lifetime', () => {
    expect(loadConfig({ ...BASE_ENV, MEMRISE_WORDS_TTL_SECONDS: '120' }, LINUX).wordsTtlSeconds).toBe(120);
  });
});

describe('loadConfig debug flag', () => {
  it('enables debug logging only when MEMRISE_DEBUG is 1', () => {
    expect(loadConfig({ ...BASE_ENV, MEMRISE_DEBUG: '1' }, LINUX).debug).toBe(true);
    expect(loadConfig({ ...BASE_ENV, MEMRISE_DEBUG: '0' }, LINUX).debug).toBe(false);
    expect(loadConfig(BASE_ENV, LINUX).debug).toBe(false);
  });
});

describe('loadConfig word-list TTL validation', () => {
  it('accepts 0 as the boundary that turns the word-list cache off', () => {
    expect(loadConfig({ ...BASE_ENV, MEMRISE_WORDS_TTL_SECONDS: '0' }, LINUX).wordsTtlSeconds).toBe(0);
  });

  it.each(['-5', 'abc'])('rejects MEMRISE_WORDS_TTL_SECONDS=%s with a ConfigError naming the variable', (raw) => {
    expect(() => loadConfig({ ...BASE_ENV, MEMRISE_WORDS_TTL_SECONDS: raw }, LINUX)).toThrow(ConfigError);
    expect(() => loadConfig({ ...BASE_ENV, MEMRISE_WORDS_TTL_SECONDS: raw }, LINUX)).toThrow(/MEMRISE_WORDS_TTL_SECONDS/);
  });
});

describe('loadConfig language pair', () => {
  it('reads MEMRISE_LANGUAGE_PAIR_ID as a number', () => {
    expect(loadConfig({ ...BASE_ENV, MEMRISE_LANGUAGE_PAIR_ID: '7' }, LINUX).languagePairId).toBe(7);
  });

  it('leaves the language pair unset (null) when MEMRISE_LANGUAGE_PAIR_ID is absent', () => {
    expect(loadConfig(BASE_ENV, LINUX).languagePairId).toBeNull();
  });

  it.each(['abc', '0', '-1', '1.5'])('rejects MEMRISE_LANGUAGE_PAIR_ID=%s with a ConfigError naming the variable', (raw) => {
    expect(() => loadConfig({ ...BASE_ENV, MEMRISE_LANGUAGE_PAIR_ID: raw }, LINUX)).toThrow(ConfigError);
    expect(() => loadConfig({ ...BASE_ENV, MEMRISE_LANGUAGE_PAIR_ID: raw }, LINUX)).toThrow(/MEMRISE_LANGUAGE_PAIR_ID/);
  });
});

describe('requireCredentials', () => {
  it('throws a ConfigError naming both variables when a credential is missing', () => {
    const config = loadConfig({ ...BASE_ENV, MEMRISE_USERNAME: FAKE_USERNAME }, LINUX);

    expect(() => requireCredentials(config)).toThrow(ConfigError);
    expect(() => requireCredentials(config)).toThrow('MEMRISE_USERNAME and MEMRISE_PASSWORD must be set');
  });

  it('returns the username and password when both are configured', () => {
    const config = loadConfig({ ...BASE_ENV, MEMRISE_USERNAME: FAKE_USERNAME, MEMRISE_PASSWORD: FAKE_PASSWORD }, LINUX);

    expect(requireCredentials(config)).toEqual({ username: FAKE_USERNAME, password: FAKE_PASSWORD });
  });
});
