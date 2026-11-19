/** Runtime configuration read from environment variables; only the default cache folder may fall back to the OS home folder. */

import { homedir } from 'node:os';
import { posix, win32 } from 'node:path';
import { ConfigError, MISSING_CREDENTIALS_MESSAGE } from '../errors.js';

type Env = Readonly<Record<string, string | undefined>>;

const DEFAULT_WORDS_TTL_SECONDS = 3600;

/** The OS facts the cache folder default depends on; injectable so every platform is testable on any host. */
export interface Host {
  platform: NodeJS.Platform;
  homedir: () => string;
}

const CURRENT_HOST: Host = { platform: process.platform, homedir };

export interface Config {
  username?: string;
  password?: string;
  languagePairId: number | null;
  cacheDir: string;
  wordsTtlSeconds: number;
  debug: boolean;
}

export interface Credentials {
  username: string;
  password: string;
}

export function requireCredentials(config: Config): Credentials {
  if (!config.username || !config.password) {
    throw new ConfigError(MISSING_CREDENTIALS_MESSAGE);
  }
  return { username: config.username, password: config.password };
}

/** Parses the environment; throws `ConfigError` naming the variable when a value is invalid. */
export function loadConfig(env: Env, host: Host = CURRENT_HOST): Config {
  return {
    username: readOptional(env, 'MEMRISE_USERNAME'),
    password: readOptional(env, 'MEMRISE_PASSWORD'),
    languagePairId: readPairId(env),
    cacheDir: resolveCacheDir(env, host),
    wordsTtlSeconds: readWordsTtl(env),
    debug: env.MEMRISE_DEBUG === '1',
  };
}

/** Blank (empty or whitespace-only) counts as unset. */
function readOptional(env: Env, name: string): string | undefined {
  const value = env[name];
  return value === undefined || value.trim() === '' ? undefined : value;
}

function readPairId(env: Env): number | null {
  const raw = readOptional(env, 'MEMRISE_LANGUAGE_PAIR_ID');
  if (raw === undefined) return null;
  if (!/^[1-9]\d*$/.test(raw.trim())) {
    throw new ConfigError('MEMRISE_LANGUAGE_PAIR_ID must be a positive integer');
  }
  return Number(raw);
}

function readWordsTtl(env: Env): number {
  const raw = readOptional(env, 'MEMRISE_WORDS_TTL_SECONDS');
  if (raw === undefined) return DEFAULT_WORDS_TTL_SECONDS;
  if (!/^\d+$/.test(raw.trim())) {
    throw new ConfigError('MEMRISE_WORDS_TTL_SECONDS must be a non-negative integer');
  }
  return Number(raw);
}

function resolveCacheDir(env: Env, host: Host): string {
  const path = host.platform === 'win32' ? win32 : posix;
  const override = readOptional(env, 'MEMRISE_CACHE_DIR');
  if (override !== undefined) {
    if (!path.isAbsolute(override)) throw new ConfigError('MEMRISE_CACHE_DIR must be an absolute path');
    return override;
  }
  return path.join(defaultCacheRoot(env, host), 'memrise-mcp');
}

// Each OS's own convention: %LOCALAPPDATA% (machine-local, never roamed) on Windows, XDG elsewhere; HOME is often unset on Windows, so the OS home folder backs both.
function defaultCacheRoot(env: Env, host: Host): string {
  if (host.platform === 'win32') {
    return readOptional(env, 'LOCALAPPDATA') ?? win32.join(host.homedir(), 'AppData', 'Local');
  }
  return readOptional(env, 'XDG_CACHE_HOME') ?? posix.join(readOptional(env, 'HOME') ?? host.homedir(), '.cache');
}
