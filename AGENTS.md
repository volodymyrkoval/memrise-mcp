# AGENTS.md

Guidance for AI coding agents and contributors working on this repository.

## What this is

`memrise-mcp`: a read-only MCP server (stdio) and an `export` command for a Memrise learner's own words and lessons. TypeScript, Node 22+, built with tsup.

## Commands

```sh
npm install
npm test               # unit tests, fully offline
npm run typecheck
npm run check-secrets  # scans tracked files for credentials
npm run build          # tsup, to dist/
```

## Layout

- `src/api`, `src/http`, `src/auth`, `src/session`: Memrise client, login and session cache.
- `src/domain`, `src/app`, `src/cache`: joining, lookup, queries and disk caches.
- `src/mcp`: tool definitions. `src/cli`: the `export` command. `src/index.ts`: entry point.
- `tests/unit`, `tests/fixtures`: offline tests and synthetic fixtures.
- `scripts/`: probe, smoke test and secret scan. `npm run probe -- --unlinked` (needs credentials in the environment) reads only, and writes counts to `.probe-out/unlinked.md` (git-ignored).

## Rules

- **Read-only.** Never add a tool or command that changes the learner's account.
- **No secrets, no personal data.** Never log, print or commit credentials, tokens, cookies or the account's username. Test fixtures must be invented data, never real captures.
- **No details of the maintainer's own account, anywhere.** No real word or lesson counts, ids, lesson titles, words, dates, timezone or location — not in code, tests, docs, the README, commit messages or examples. Use formulas or invented values. The only personal data in this repo is the author name and e-mail in `package.json`.
- **No Memrise course content.** Fixtures and test strings must never contain or imitate Memrise's courses: no real words, sentences, glosses, lesson or topic titles, audio paths or ids. Use basic dictionary vocabulary, self-written sentences, placeholder titles and obviously synthetic ids.
- **Language-neutral.** The server serves any language on Memrise. Never assume a particular language, language pair or script in code, tool descriptions, fixtures or docs. Fixture vocabulary stays basic and invented, and language names and locales in tests are placeholders (`Alpha`, `aa-aa`).
- **Stdout belongs to the MCP protocol.** Log to stderr only, and only through the redacting logger.
- **Tests stay offline.** Unit tests must not touch the network.
- **Work test-first.** Write a failing test, make it pass, then refactor. Keep commits small and use conventional commit messages.
