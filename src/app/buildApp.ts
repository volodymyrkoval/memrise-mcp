/**
 * Composition root: the only place that constructs collaborators. It makes no network call and
 * checks no credential, so a missing or wrong password never stops the server from starting.
 */
import { randomUUID } from 'node:crypto';
import { MemriseApi } from '../api/memriseApi.js';
import { accountKey } from '../auth/accountKey.js';
import { LoginFlow } from '../auth/loginFlow.js';
import { DiskPacerLock } from '../cache/diskPacerLock.js';
import { DiskWordListCache } from '../cache/diskWordListCache.js';
import { DiskRateLimitStore } from '../cache/diskRateLimitStore.js';
import { DiskScenarioDetailsStore } from '../cache/diskScenarioDetailsStore.js';
import { ScenarioDetailsRepository } from '../cache/scenarioDetailsRepository.js';
import { loadConfig, type Config } from '../config/config.js';
import { HttpClient } from '../http/httpClient.js';
import { RequestPacer } from '../http/requestPacer.js';
import { FetchTransport, type HttpTransport, type NewId, type Now, type Sleep } from '../http/transport.js';
import { createStderrLogger, type Logger } from '../log/logger.js';
import { Redactor } from '../log/redactor.js';
import { AuthenticatedRequester } from '../session/authenticatedRequester.js';
import { FileSessionStore } from '../session/fileSessionStore.js';
import { LearnerDataLoader, type WordCacheMode } from './learnerDataLoader.js';
import { LearnerQueries } from './learnerQueries.js';

export interface BuildAppOptions {
  env: Readonly<Record<string, string | undefined>>;
  transport?: HttpTransport;
  now?: Now;
  sleep?: Sleep;
  newId?: NewId;
  /** Diagnostics sink; defaults to stderr. stdout is never written. */
  stderrWrite?: (line: string) => void;
  /** `write-only` (export) refreshes the word-list cache without reading it. */
  wordCache?: WordCacheMode;
  /** IANA zone for the learner's plain dates; defaults to the machine's zone. */
  timeZone?: string;
}

export interface App {
  config: Config;
  logger: Logger;
  redactor: Redactor;
  api: MemriseApi;
  queries: LearnerQueries;
}

export function buildApp(options: BuildAppOptions): App {
  // loadConfig's errors name variables but never carry their values, so it may run before registration.
  const config = loadConfig(options.env);
  const redactor = registerCredentials(new Redactor(), config);
  const clock = resolveClock(options);
  const logger = createStderrLogger({ debug: config.debug, redactor, write: options.stderrWrite, now: clock.now });
  const http = buildHttp(options, config, clock, logger);
  const api = buildApi(config, http, redactor, clock, logger);
  const queries = buildQueries(config, api, clock, logger, options.wordCache ?? 'read-write', options.timeZone ?? machineTimeZone());
  return { config, logger, redactor, api, queries };
}

interface Clock {
  now: Now;
  sleep: Sleep;
  newId: NewId;
}

function resolveClock(options: BuildAppOptions): Clock {
  return {
    now: options.now ?? Date.now,
    sleep: options.sleep ?? defaultSleep,
    newId: options.newId ?? randomUUID,
  };
}

function buildHttp(options: BuildAppOptions, config: Config, clock: Clock, logger: Logger): HttpClient {
  return new HttpClient({
    transport: options.transport ?? new FetchTransport(),
    pacer: new RequestPacer({
      now: clock.now,
      sleep: clock.sleep,
      lock: new DiskPacerLock({ cacheDir: config.cacheDir, now: clock.now, sleep: clock.sleep, logger }),
    }),
    sleep: clock.sleep,
    now: clock.now,
    newId: clock.newId,
    logger,
    rateLimit: new DiskRateLimitStore({ cacheDir: config.cacheDir, logger }),
  });
}

/** Session lifecycle (lazy login, Bearer) in front of the endpoint client. */
function buildApi(config: Config, http: HttpClient, redactor: Redactor, clock: Clock, logger: Logger): MemriseApi {
  const requester = new AuthenticatedRequester({
    config,
    store: new FileSessionStore({
      cacheDir: config.cacheDir,
      account: accountKey(config.username ?? ''),
      now: clock.now,
      logger,
    }),
    loginFlow: new LoginFlow({ http, redactor }),
    http,
    logger,
    now: clock.now,
  });
  return new MemriseApi({ requester, logger });
}

/** Disk caches and the in-process loader that sits on top of them. */
function buildQueries(
  config: Config,
  api: MemriseApi,
  clock: Clock,
  logger: Logger,
  wordCacheMode: WordCacheMode,
  timeZone: string,
): LearnerQueries {
  const repository = new ScenarioDetailsRepository({
    store: new DiskScenarioDetailsStore({ cacheDir: config.cacheDir, now: clock.now, logger }),
    api,
    logger,
  });
  const loader = new LearnerDataLoader({
    api,
    repository,
    wordCache: new DiskWordListCache({
      cacheDir: config.cacheDir,
      ttlSeconds: config.wordsTtlSeconds,
      now: clock.now,
      logger,
    }),
    wordCacheMode,
    languagePairId: config.languagePairId,
    logger,
  });
  return new LearnerQueries({ loader, api, timeZone });
}

/** Username and password go into the redactor before any logger or client exists, so no later output can echo them raw. */
function registerCredentials(redactor: Redactor, config: Config): Redactor {
  if (config.username !== undefined) redactor.addSecret(config.username);
  if (config.password !== undefined) redactor.addSecret(config.password);
  return redactor;
}

function machineTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
