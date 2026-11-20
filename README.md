# memrise-mcp

Connect Claude to your Memrise account, so Claude knows which words you've learned, how well you know them, and which lessons they come from. Then it can quiz you, explain things using words you already know, or write practice texts at your level.

> **Unofficial.** This is a personal project, not made or endorsed by Memrise. It relies on the way Memrise's website works today, so it may stop working if Memrise changes something. Use it only with your own account, at your own risk.

## What you can ask

Once it's set up, just talk to Claude about your Memrise learning. For example:

- "Which Memrise lessons did I finish this month, and what were they about?"
- "Quiz me on the words from my last Memrise lesson."
- "Which of my Memrise words do I find difficult?"
- "What should I review today?"
- "Which words from my lesson about food am I still weak on?"
- "Which words have I only heard but not studied yet?"
- "Do I already know these words from Memrise: *(a few words in the language you are learning)*?"
- "Write me a short story using only words I've learned in Memrise."

Claude can only **read** your Memrise data. It never changes anything in your account: no reviews, no progress, no settings.

## What you need

- The [Claude Desktop app](https://claude.ai/download) on a Mac, Windows or Linux.
- A Memrise account that you log into with an **e-mail and password**. If you signed up with Google, set a password first, for example with "Forgot password" on Memrise's sign-in page.
- **Node.js**, a free program that runs this tool. Download the "LTS" version from [nodejs.org](https://nodejs.org) and install it like any other app.

## Set it up

1. **Open Claude's settings file.** In Claude Desktop, open **Settings → Desktop app** and click **Manage** next to **Extensions**. Under **Local MCP servers**, click **Edit config**. This opens (or shows you) a file called `claude_desktop_config.json`.
2. **Paste the connection details.** If the file is empty, or contains only `{}`, replace everything in it with:

   ```json
   {
     "mcpServers": {
       "memrise": {
         "command": "npx",
         "args": ["-y", "memrise-mcp"],
         "env": {
           "MEMRISE_USERNAME": "your-email@example.com",
           "MEMRISE_PASSWORD": "your-memrise-password"
         }
       }
     }
   }
   ```

   If the file already has an `"mcpServers"` section, add only the `"memrise": { … }` part inside it, and put a comma between it and the entry before it.
3. **Put in your own login.** Replace `your-email@example.com` and `your-memrise-password` with your Memrise e-mail and password. Keep the quotation marks.
4. **Save the file, then quit Claude completely** (on a Mac: **Claude → Quit**, or ⌘Q; on Windows: **File → Exit**, and if Claude keeps running, right-click its icon near the clock and choose **Quit**, or end it in Task Manager; on Linux: quit it from its menu or tray icon) **and open it again.**
5. **Try it.** Ask Claude: *"List my Memrise courses."*

The very first question takes a while, up to a minute or two: the tool downloads itself and then reads all your lessons once. After that, answers come quickly.

**Learning more than one language on Memrise?** Ask Claude to list your Memrise courses and note the number of the one you want. Then add a line with that number below your password, in the same file:

```json
"MEMRISE_LANGUAGE_PAIR_ID": "12345"
```

(Put a comma at the end of the password line before it.) Save, quit and reopen Claude.

## Be gentle with Memrise

This tool uses Memrise's website the way the website itself does. Memrise doesn't offer this as an official service and has never said how much use is acceptable. Heavy use could get your account blocked, or this tool blocked for everyone. So the tool works slowly and politely on purpose: one request at a time, with pauses, and it remembers what it has already fetched instead of asking again.

You can help:

- **Don't ask Claude to check Memrise over and over in a loop**, or set up anything that does so automatically.
- **Your word list refreshes at most once an hour.** Words you learned in the last hour may not show up yet. That's intentional.
- **If Claude reports that Memrise asked us to slow down, stop** and try again later.

## Your privacy

- **Your password is stored in Claude's settings file** on your computer, as plain text. Anyone who can use your computer account could read it. Use a password you don't use anywhere else.
- **What Claude reads becomes part of your conversation.** Like anything else you share with Claude, your words and lessons are sent to Claude while you chat.
- **The tool keeps a copy of your learning data on your computer**, in a folder called `memrise-mcp` (on a Mac or Linux, inside the hidden `.cache` folder in your home folder; on Windows, inside `%LOCALAPPDATA%`), so it doesn't have to ask Memrise every time. It holds your words, your lessons and a login token, never your password.
- Nothing is sent anywhere else.

## If something goes wrong

- **Claude doesn't seem to know about Memrise.** Make sure you saved the settings file and *fully* quit and reopened Claude. Then open **Settings → Desktop app → Extensions: Manage**: `memrise` should appear under **Local MCP servers**. If it has a red **Failed** badge, click it and then **View logs** to see why, and check the next items.
- **"Could not sign in to Memrise".** Check the e-mail and password in the settings file. Try logging into memrise.com with the same details. If you signed up with Google, you may need to set a password first.
- **Claude says the Memrise tool failed to start.** Check that Node.js is installed: quit Claude, install Node.js from [nodejs.org](https://nodejs.org) (or reinstall it), and open Claude again. On Windows, if Node.js is installed and it still fails, change `"command": "npx"` and `"args"` in the settings file to:

  ```json
  "command": "cmd",
  "args": ["/c", "npx", "-y", "memrise-mcp"],
  ```
- **The first question timed out.** Just ask again. The tool keeps what it has already fetched, so each try gets further.
- **"Memrise asked us to slow down".** Memrise is rate-limiting the tool. The message says when to try again; wait until then.
- **"Another memrise-mcp process is still talking to Memrise".** Another program using the tool (for example a scheduled export) is busy. Wait a few minutes and ask again.

## Removing it

1. Open the settings file again (**Settings → Desktop app → Extensions: Manage → Local MCP servers → Edit config**) and delete the `"memrise": { … }` part. Save, then quit and reopen Claude.
2. Delete the tool's saved data: the `memrise-mcp` folder. On a Mac, it is inside the hidden `.cache` folder in your home folder: in Finder choose **Go → Go to Folder…**, type `~/.cache`, press Return, and move `memrise-mcp` to the Trash. On Windows, press **Windows+R**, type `%LOCALAPPDATA%`, press Enter, and delete the `memrise-mcp` folder. On Linux, run `rm -rf ~/.cache/memrise-mcp`.

---

## Advanced

[![CI](https://github.com/volodymyrkoval/memrise-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/volodymyrkoval/memrise-mcp/actions/workflows/ci.yml)

Everything below is for developers and people using other AI tools. Running the server needs Node.js 22 or newer.

### Other MCP clients

The server speaks MCP over stdio; any MCP client can run it. For Claude Code:

```sh
claude mcp add memrise \
  -e MEMRISE_USERNAME='<your-memrise-login>' \
  -e MEMRISE_PASSWORD='<your-password>' \
  -- npx -y memrise-mcp
```

To try it without a client: `npx @modelcontextprotocol/inspector -e MEMRISE_USERNAME=... -e MEMRISE_PASSWORD=... npx -y memrise-mcp`.

If a desktop app can't start the server, it may be launching it with a minimal `PATH`: use the absolute path of `npx` (`which npx`) as `command`.

### Updating and pinning

`npx -y memrise-mcp` runs the latest release from npm. To pin a version, use `memrise-mcp@0.1.0` instead, for example `"args": ["-y", "memrise-mcp@0.1.0"]`. `npx` caches what it downloads, so to move to a newer release change the version, or delete npx's cache (`rm -rf ~/.npm/_npx`) and restart the client. `npx -y memrise-mcp --version` prints the version and `npx -y memrise-mcp --help` the usage.

### Settings (environment variables)

| Variable | Meaning |
|----------|---------|
| `MEMRISE_USERNAME`, `MEMRISE_PASSWORD` | Your login. Required for any data call. |
| `MEMRISE_LANGUAGE_PAIR_ID` | Which course to read. Only needed if the account has several. |
| `MEMRISE_CACHE_DIR` | Cache folder (absolute path). Default: macOS and Linux `$XDG_CACHE_HOME/memrise-mcp`, else `~/.cache/memrise-mcp`; Windows `%LOCALAPPDATA%\memrise-mcp`. |
| `MEMRISE_WORDS_TTL_SECONDS` | How long the word list is cached. Default `3600`; `0` turns it off (debugging only). |
| `MEMRISE_DEBUG` | `1` writes debug lines to stderr. |

### Load and caching

- One request at a time, at least 0.3 s apart, across every process sharing the cache folder.
- Retries network errors and 5xx up to 3 attempts. On HTTP 429 it waits as long as `Retry-After` asks (60 s if absent), retries once, then fails and records a cooldown that every process respects. A wait over 2 minutes fails at once, and no cooldown lasts more than 24 hours.
- Cache: the login token until Memrise rejects it; details of completed lessons forever (a finished lesson never changes; incomplete ones are re-fetched); the word list for `MEMRISE_WORDS_TTL_SECONDS`.
- A cold cache costs about one request per completed lesson, plus one page per 50 words and one page per 20 lessons (completed and in-progress lessons are listed separately), plus 2 login requests when there is no saved token (none with one) and 1 more to find the course when `MEMRISE_LANGUAGE_PAIR_ID` is not set.
- Processes on the same cache folder share what they fetch: when two run at once, the one waiting for its turn uses a lesson or login token the other has just saved instead of asking for it again.
- A warm cache still lists the lessons again each time the server starts (one page per 20 lessons) and re-fetches unfinished lessons; it asks for nothing else until the word list expires.
- Cache folder contents: `session.json` (login token), `words-*.json` (word lists), `scenario-details/` (one file per lesson), `pacer.lock` and `pacer.json` (request pacing across processes), `rate-limit.json` (the 429 cooldown).
- For scheduled jobs, run `export` once a day and read the file instead of polling.

### Export

```sh
memrise-mcp export --out words.json [--state any|fully_learned_or_known] [--include-audio]
```

Writes your words, lessons and a `fetched_at` timestamp to one JSON file. It always fetches the word list fresh, then saves it to the cache shared with the server, so it also warms it.

### Tool reference

| Tool | What it does |
|------|--------------|
| `language_pairs_list` | Your language pairs and their ids. |
| `learnables_list` | Your words, with lessons and topics. Filter instead of paging (see below). Pages of 200 by default; when `truncated` is true, call again with `after_id` set to `next_after_id`. |
| `learnables_lookup` | Checks whether given words or phrases appear among your words (ignores case, accents, punctuation and one leading article; the article list is best-effort and covers English, Spanish, Portuguese, French, Italian and German, so for other languages only case, accents and punctuation are loosened). |
| `scenarios_list` | Your lessons, newest first. Filter with `type` (`completed` or `in_progress`) and `since` (see Dates below). |
| `scenario_learnables` | The words of one lesson. |

Each word comes back as `id` (Memrise's numeric id for the word, the same in every lesson), `word` (as written in the language you are learning) and `translation` (its meaning in your own language), with its growth level, lessons and topics. The `export` file uses the same keys.

**`learnables_list` filters.** All are optional, combine with AND, and apply before paging: `total` counts the matching words, and `after_id` continues inside the filtered list (an `after_id` that the filters exclude is an error). A filter that matches nothing gives `total: 0`. `limit` (default 200) is the page size.

| Parameter | Keeps |
|-----------|-------|
| `difficult`, `learned`, `known`, `heard` | Words where the flag is `true` (or, with `false`, words where it is `false`). |
| `due_before` | Words whose `next_review` is at or before this moment. Words with no `next_review` (never studied, or already known) are ignored. The result is ordered most overdue first (ascending `next_review`, ties by id); without `due_before` the usual order applies. A plain date `YYYY-MM-DD` means the end of that day, so "due today" is today's date. |
| `topic`, `lesson` | Words taught by a topic or lesson with that title. Whole words only, any case or accents: `food` matches "Food & Drink" but not "Seafood". Several words must appear next to each other, in order: `at the restaurant` matches "At the Restaurant 1". Words that no lesson teaches never match. When the text matches no topic (or lesson) at all, `warnings` gets one line such as `No topic matches "quantum physics". Topics: Basics, Food, Travel.`, listing up to 30 names sorted alphabetically (`(+N more)` after that); it is not added when the topic exists but other filters leave no word. |
| `min_growth_level`, `max_growth_level` | Words in that growth-level range, both ends included. The minimum must not be above the maximum. |

**Word fields added to every word row (`learnables_list`, `learnables_lookup`, `scenario_learnables`, `export`).**

- `heard` is Memrise's own flag that the word has been heard; Memrise does not document exactly what sets it, so nothing more is claimed. `heard: true` on a word that is not learned or known means it was only heard, never studied. Filter with `heard` to list such words.
- `next_review` is `null` unless the word is learned. Words never studied and words you marked as already known have none, whatever date Memrise holds for them, so they never count as due.
- `origin` says where the word comes from. `"lesson"`: a completed or in-progress lesson teaches it. `"other"`: none of your lessons teaches it. In practice these are words you have only heard (`heard: true`, not learned or known) from content outside your lessons; they have no `lessons` or `topics`, and `next_review` is `null` so they never look overdue. `"unknown"`: no lesson is linked to it, but some lesson could not be read in this response, so the link may only be missing; `warnings` says the lesson links are incomplete. Asking again once the lesson loads gives the right value. Words from `scenario_learnables` are always `"lesson"`.

**Dates.** `due_before` and `since` take either `YYYY-MM-DD` or a date-time that ends in `Z` or an offset such as `+01:00` (used exactly as given). A plain date is read in the time zone of the computer running the tool: `since` means the start of that day (inclusive), `due_before` the end of it. A date-time without a time zone, or something that is not a date, is rejected with a message that says how to fix it. `since` keeps lessons completed at or after that moment.

**`learnables_lookup` results.** Each term gets `met`, `match`, `items`, `in_sentences` (up to 5 longer phrases that contain the term; `in_sentences_total` counts them all) and `in_translations` (up to 5 words whose translation contains the term, for a term in your own language; `in_translations_total` counts them all). `match` is `exact` (a word equals the term), `in_sentence` (only longer phrases contain it), `translation` (nothing matched in the language you are learning, only a translation did) or `none`; `met` is true for everything but `none`. A word already listed under `items` or `in_sentences` is not repeated under `in_translations`. There is no stemming: if a conjugated or plural form is not found, try its dictionary form as well. Terms shorter than 3 characters, and a lone article, match whole words and whole translations only, never parts of longer phrases.

`state` (on word tools) is `any` (everything you have met, the default) or `fully_learned_or_known`. If some lesson details cannot be fetched, results still come back with a `warnings` field.

### Security details

- The password is read from the environment and never written to disk. Only a login token is cached, in `session.json`; anyone who can read it can read your Memrise data. On macOS and Linux the file mode is `0600` and the folder `0700`. Windows does not enforce these modes: there the token file is protected only by the default permissions of your user profile.
- Logs and errors never contain the username, password or tokens.
- The cache and export files hold learning data; don't share them.

### Development

```sh
npm install
npm test               # offline unit tests
npm run test:realfs    # real-filesystem tests: two processes sharing one cache folder
npm run smoke:startup  # packs the server, starts it like npx does, lists the 5 tools
npm run typecheck
npm run build
npm run check-secrets
npm run check-versions # package.json, server.json and src/version.ts agree
```

Developing needs Node.js 22.18 or newer (vitest 5 and tsup 9 require it); CI tests Node 22 and 24.

See [AGENTS.md](AGENTS.md) for contributor and AI-agent guidance. Test fixtures are invented data. `npm run smoke` runs a live check when credentials are set and is skipped otherwise.
