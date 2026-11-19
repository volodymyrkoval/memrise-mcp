/**
 * Startup smoke test (`npm run smoke:startup`): packs this repo with `npm pack`, installs the tarball
 * into a throwaway project, and starts the server through the installed bin shim, as `npx` would.
 * An MCP client then lists the tools over stdio and calls `language_pairs_list` with no credentials,
 * expecting the clean "must be set" error rather than a crash. It runs twice: once with
 * MEMRISE_CACHE_DIR, once with the OS default cache folder (pointed at a temp folder). Needs the
 * npm registry for the runtime dependencies only; never contacts Memrise. Exits 1 on any failure.
 *
 * MEMRISE_SMOKE_NODE (optional) is the path of the Node binary the server must run on. It goes first
 * on the server's PATH, which the bin shim uses, so CI can check the oldest supported Node while
 * npm, tsup and tsx run on a newer one.
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const EXPECTED_TOOLS = ['language_pairs_list', 'learnables_list', 'learnables_lookup', 'scenario_learnables', 'scenarios_list'];
const IS_WINDOWS = process.platform === 'win32';

interface Folders {
  root: string;
  pack: string;
  project: string;
  cache: string;
  defaultCacheRoot: string;
}

async function main(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'memrise-startup-smoke-'));
  const folders: Folders = {
    root,
    pack: join(root, 'pack'),
    project: join(root, 'project'),
    cache: join(root, 'cache'),
    defaultCacheRoot: join(root, 'default-cache-root'),
  };
  try {
    const tarball = await pack(folders.pack);
    await installInto(folders.project, tarball);
    const bin = binShim(folders.project);
    const nodePath = serverNodePath();
    await checkServer('with MEMRISE_CACHE_DIR', bin, folders.project, { ...nodePath, MEMRISE_CACHE_DIR: folders.cache });
    await checkServer('with the default cache folder', bin, folders.project, { ...nodePath, ...defaultCacheEnv(folders.defaultCacheRoot) });
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

/** `npm pack` runs `prepare`, which builds dist/ first. Returns the tarball path. */
async function pack(destination: string): Promise<string> {
  await mkdir(destination, { recursive: true });
  step('npm pack');
  await runNpm(['pack', '--pack-destination', destination], REPO_ROOT);
  const tarballs = (await readdir(destination)).filter((name) => name.endsWith('.tgz'));
  if (tarballs.length !== 1) throw new Error(`expected one tarball from npm pack, found: ${tarballs.join(', ') || 'none'}`);
  return join(destination, tarballs[0]);
}

async function installInto(project: string, tarball: string): Promise<void> {
  await mkdir(project, { recursive: true });
  await writeFile(join(project, 'package.json'), `${JSON.stringify({ name: 'startup-smoke', private: true }, null, 2)}\n`);
  step('npm install of the tarball');
  await runNpm(['install', '--omit=dev', '--no-audit', '--no-fund', tarball], project);
}

/** The shim npm writes for the `bin` entry: a symlink on macOS and Linux, a `.cmd` wrapper on Windows. */
function binShim(project: string): string {
  return join(project, 'node_modules', '.bin', IS_WINDOWS ? 'memrise-mcp.cmd' : 'memrise-mcp');
}

/** PATH with MEMRISE_SMOKE_NODE's folder first, or nothing (the inherited PATH) when it is unset. */
function serverNodePath(): Record<string, string> {
  const serverNode = process.env.MEMRISE_SMOKE_NODE;
  if (!serverNode) return {};
  const version = spawnSync(serverNode, ['--version'], { encoding: 'utf8' });
  if (version.status !== 0) throw new Error(`MEMRISE_SMOKE_NODE does not run: ${serverNode}`);
  step(`server runs on Node ${version.stdout.trim()}`);
  return { PATH: [dirname(serverNode), process.env.PATH ?? ''].join(delimiter) };
}

/** Points the platform's default cache root at a temp folder, so the run never touches the real one. */
function defaultCacheEnv(cacheRoot: string): Record<string, string> {
  return IS_WINDOWS ? { LOCALAPPDATA: cacheRoot } : { XDG_CACHE_HOME: cacheRoot };
}

/**
 * Starts the server through `bin` with no credentials in its environment (the SDK passes only a
 * small safe list of the parent's variables, plus `env`), then checks the tools and the error.
 */
async function checkServer(label: string, bin: string, cwd: string, env: Record<string, string>): Promise<void> {
  step(`server ${label}`);
  const transport = new StdioClientTransport({ command: bin, args: [], cwd, env, stderr: 'pipe' });
  let serverStderr = '';
  transport.stderr?.on('data', (chunk: Buffer) => (serverStderr += chunk.toString('utf8')));
  const client = new Client({ name: 'memrise-mcp-startup-smoke', version: '0.0.0' });
  try {
    await client.connect(transport);
    await expectTools(client);
    await expectMissingCredentialsError(client);
    await client.ping();
  } catch (err) {
    throw new Error(`${label}: ${err instanceof Error ? err.message : String(err)}${serverStderr ? `\nserver stderr:\n${serverStderr}` : ''}`);
  } finally {
    await client.close();
  }
}

async function expectTools(client: Client): Promise<void> {
  const names = (await client.listTools()).tools.map((tool) => tool.name).sort();
  if (JSON.stringify(names) !== JSON.stringify(EXPECTED_TOOLS)) {
    throw new Error(`expected tools ${EXPECTED_TOOLS.join(', ')}; got ${names.join(', ')}`);
  }
}

async function expectMissingCredentialsError(client: Client): Promise<void> {
  const result = (await client.callTool({ name: 'language_pairs_list', arguments: {} })) as CallToolResult;
  const text = result.content.map((part) => (part.type === 'text' ? part.text : '')).join('\n');
  if (result.isError !== true || !text.includes('must be set')) {
    throw new Error(`expected an isError result saying the credentials must be set; got ${JSON.stringify(result)}`);
  }
}

/**
 * Runs npm through Node with npm's own entry script, so no shell is involved (Node refuses to spawn
 * `npm.cmd` without one on Windows). Output goes to stderr, keeping this script's stdout readable.
 */
function runNpm(args: readonly string[], cwd: string): Promise<void> {
  const npmCli = process.env.npm_execpath ?? bundledNpmCli();
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [npmCli, ...args], { cwd, stdio: ['ignore', process.stderr, process.stderr] });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`npm ${args[0]} exited with ${code}`))));
  });
}

/** npm's entry script beside this Node, for runs started without `npm run`. */
function bundledNpmCli(): string {
  const nodeDir = dirname(process.execPath);
  return IS_WINDOWS
    ? join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js')
    : join(nodeDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js');
}

function step(message: string): void {
  console.log(`startup smoke: ${message}`);
}

main().then(
  () => step('passed'),
  (err: unknown) => {
    console.error(`startup smoke failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  },
);
