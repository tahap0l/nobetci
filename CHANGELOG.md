# Changelog

All notable changes to Nöbetçi are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- Never approve a request automatically when the risk engine scored it HIGH or CRITICAL, even after
  a re-scoring rule lowered it. A broad rule such as "git push → LOW" used to let a force push
  through on its own in a trusted project; now it is a plain click. "Don't ask again in this
  session" is only offered where it can take effect.
- Score MCP tools by their name even when an argument is called `url` or `command`, and check those
  arguments with the web and command rules as well. `mcp__notion__delete_page` with a `url` was
  scored as an ordinary LOW web request.
- Show and match every MCP argument: the card, rules and session grants used to see only the first
  600 characters.
- Flag downloaded code run through a longer pipe (`curl … | tee x | bash`, CRITICAL) and fetched
  then run in the same command (`curl -o x.sh … && bash x.sh`, `chmod +x`, `source`, HIGH).
- Treat Claude Code's `WebSearch` as a known web request instead of an unrecognized one.
- Close a card when the request was answered in the terminal. Claude Code sends `PostToolUse`
  with a `tool_use_id` that `PermissionRequest` never has, so the card stayed until it timed out.
  Long commands, cut by the relay in the later event, are matched too.
- Stop keeping a record of every answered request in the island's memory, and stop showing
  "waiting for approval" on sessions whose requests were handed to the terminal by Pause.
- Keep a copy of a settings file that cannot be read before falling back to defaults, accept a
  UTF-8 BOM in it, and write it atomically, so a crash or a hand edit no longer wipes every rule.
- Give every rule its own id; rules added in the same millisecond shared one.
- Write the CSV export's header and the Codex/Cursor diff header in the app's language.

### Changed

- Offer Claude Code's `PreCompact` and `PostCompact` events, which the island already shows.
- Build the front end for Safari 14 on macOS, the WebView macOS 11 ships.
- Update Vite to 8, TypeScript to 7, the Tauri plugins and the CI actions; this clears the two
  high-severity advisories `npm audit` reported for Vite 6. Building from source now needs
  Node.js 22 or newer (20.19 also works).

## [2.1.7] - 2026-11-11

### Changed

- Give the wolf, hawk, octopus, lion, canary, and eagle a full body and every movement the owl has. On
  the island and in the greeting they now breathe, blink, follow the pointer, wave at a permission
  request, bristle at a risky one, hop when a session finishes, doze, and get dizzy when poked, each with
  its own ears, face, limbs, feet, and tail.
- Redraw the same six mascots for session rows and the settings gallery in the owl's style: flat colors, a
  dark outline, large rimmed eyes, and the owl's expressions. The website and web demo use the same
  drawings.
- Draw the island's tab, focus timer, calendar, and media settings icons, and the website's feature
  icons, as line icons instead of font symbols, so they look the same on every system.
- Show the same animated, full-body mascots on the website: the home page companion and the web demo now
  run the app's own mascot engine, and fall back to the drawn heads if it does not load.
- Refresh every README image and add a picture of all seven mascots. `npm run screenshots` now renders
  all of them, including the first image and the mascot picture, and runs on macOS and Linux with any
  Chromium-based browser.

## [2.1.6] - 2026-11-10

### Fixed

- Launch Windows Codex hooks with PowerShell's call operator. The health check distinguishes the
  relay test signal from the last live Codex event. Review and trust the repaired hooks again after updating.
- Keep the session list reachable when the expanded island is crowded.
- Publish the website and demo on GitHub Pages as an alternate address.

### Changed

- Split the expanded island into Media & focus, Calendar, and Weather with vertical navigation,
  themed transitions, and table layouts for the weekly calendar and current weather.
- Show media artwork and supported playback controls on Windows, and count active subagents in session details.
- Animate all seven web mascots with distinct reactions to pending, risky, approved, and denied requests.

## [2.1.5] - 2026-11-10

- Slim down the idle island and replace the large music card with a horizontal player next to the focus timer.
- Redraw the wolf with larger eyes that follow the pointer and look toward permission requests.
- Refresh the website demo and README previews.

## [2.1.4] - 2026-11-10

- Put sessions awaiting attention first and add keyboard search by project, agent, or terminal.
- Show before-and-after excerpts for edit requests and require manual review for unrecognized or incomplete requests.
- Verify physical holds for high-risk approvals and limit concurrent relay connections and initial message time.
- Detect outdated Codex SessionEnd timeouts and keep other hooks when reinstalling. Refuse to write hook settings changed since preview.
- Add a Spotify playback animation with reduced-motion support and a gallery of seven illustrated mascots.

- Give ChatGPT a dedicated settings tab alongside Claude Code and link to it from the island.
- Add a relay health check and report incomplete hook installations for local ChatGPT Work, Codex, and Cursor.
- Document the desktop Hooks list workaround. Work Cloud does not run local hooks, and live ChatGPT approval delivery has not yet been verified.

## [2.1.3] - 2026-11-09

- Redesigned the expanded Dynamic Island with animated agent, media, and focus cards.
- Added a 25-minute focus timer with pause and reset. Calendar and weather remain one swipe away.
- Added a ChatGPT Web setup entry under Other agents.

## [2.1.2] - 2026-11-09

- Keep the compact Dynamic Island visible while idle and show the date, weather, and active Windows media in rotation.
- Add a weekly calendar and swipe between calendar, weather, and media cards. Agent approvals still take priority.
- Refresh desktop and demo mascot artwork and update the English and Turkish README files.
- Add an opt-in ChatGPT Web response-status bridge for Chrome and Edge on Windows.

## [2.1.1] - 2026-11-09

- Added optional weather and Windows media controls to the desktop island, including when no agent session is active.
- Added Codex context compaction events and a shortcut to Codex and Cursor setup.

## [2.1.0] - 2026-11-09

- Added seven mascot themes with saved preferences.
- Show the session working directory on approval cards.
- Added an interactive approval demo to the website.

## [2.0.2] - 2026-10-20

### Added

- **Codex and Cursor monitoring.** Install their local hooks from Settings → Other agents to track sessions and submitted prompts. Codex permission requests and Cursor shell/MCP requests can be reviewed from the island; exact configuration diffs and timestamped backups are shown before changing settings.
- **Safe prompt handling.** Prompt events are recorded in the session timeline. Agent hooks cannot replace submitted text, so typo correction stays in Prompt Studio and the user pastes the reviewed result.
- **Safe fallback and cleanup.** Cursor permission hooks fail closed; if Nöbetçi cannot decide, the action is denied with a retry message. Uninstall removes only Nöbetçi's own hooks.

## [2.0.1] - 2026-10-20

### Added

- **Prompt Studio.** Revise messages for Claude Code, Codex, Cursor, ChatGPT, Gemini and other agents. Local Ollama is the default; OpenAI API is optional and explicit. Review and copy the result yourself.
- **Microsoft Store preparation.** Add an offline package configuration and bilingual privacy and submission guidance.


## [0.2.0] - 2026-10-03

The first public release: a watchful owl for Claude Code on Windows 10 and 11 and, as a beta, on
macOS 11 or later.

### Added

- **The island.** A small owl on a black island at the top of the screen shows every Claude Code
  session on its own row — what it's doing, for how long, and whether it's done, failed or waiting
  for you. A session detail view adds a timeline of recent steps, counters, **Go to window** (brings
  the session's terminal or editor to the front) and the project folder. The island opens by
  itself for permission requests, errors and questions, and folds into a thin strip at the top
  edge when nothing needs you.
- **Approval cards** for Claude Code's permission requests: the full command, file path, URL or
  MCP arguments with the risky parts highlighted; a queue of up to six requests; a countdown to
  when the terminal takes over; **Allow**, **Deny**, deny with a ready-made reason that Claude
  reads, **Deny and stop Claude**, **Hand to terminal**, and "don't ask again for this request in
  this session" wherever the auto-allow ceiling allows it.
- **A risk engine** that scores every request LOW, MEDIUM, HIGH or CRITICAL and says why. It reads
  commands (Bash and PowerShell), file writes and their content, file reads, web requests and MCP
  tools, and covers dozens of categories: download-and-execute, encoded commands, tampering with
  security tools (Defender, Gatekeeper, SIP, firewalls), persistence (Run keys, scheduled tasks,
  LaunchAgents), suspicious built-in Windows tools, secrets and exfiltration (the macOS keychain
  included),
  destructive git operations, publishing, cloud and database deletions, changes to Claude Code's
  own settings and hooks, changes to Nöbetçi's own files, invisible characters, content hidden behind long runs of whitespace,
  and more. Categories can be switched off one by one, except the two that catch hiding.
- **Press and hold to allow** HIGH requests (1.2 s by default) and CRITICAL ones (2.4 s).
- **Rules** that match on tool, pattern (contains, starts with, equals, glob or regex) and project
  folder, and then allow, deny with a message for Claude, always ask, or re-score a request.
  The first match wins. Comes with templates and a tester that evaluates a draft before you save.
- **Project trust** — trusted, normal or strict — and an **auto-allow ceiling** (off, LOW only,
  or LOW + MEDIUM) for everything that decides without you.
- **History**: every permission request with its risk, findings, decision, who decided and how
  long it took. Search, filters, statistics and charts, and CSV or JSON export of everything that
  matches. The log rolls over at a configurable size and can be turned off or cleared.
- **Notifications and quiet**: desktop notifications while the island is out of sight; do not
  disturb, quiet hours and (on Windows) quiet in full screen; synthesised sounds that can be muted one by one.
- **Global hotkeys** to open the island, deny, allow (LOW only, not set by default) and toggle do
  not disturb.
- **A settings window** with General, Claude Code, Safety, Rules, Notifications, History and About
  pages, settings import, export and reset — and a **welcome wizard** on first launch.
- **A careful hook installer** for `~/.claude/settings.json`: it shows a diff, saves a dated
  backup, merges without touching other tools' hooks, writes only after you confirm, and refuses if
  the file changed in the meantime. You choose which hook events to install, and a **health
  check** pings the app through the real relay.
- **English and Turkish**, following the system language unless you pick one. What
  Claude is told when you deny a request follows the same language.
- **Placement and behaviour**: the island can sit left, centre or right, on the main display or the
  one with the mouse; start with Windows or at login; adjustable auto-close and stale-session
  cleanup.
- **A per-user installer** that needs no administrator rights. Uninstalling removes Nöbetçi's own
  hook entries from `~/.claude/settings.json` (with a dated backup) and nothing else.
- **macOS (beta)**: one universal app for Apple silicon and Intel in a disk image. It lives in the
  menu bar, the island sits just below the menu bar (clear of the notch), the relay talks to the
  app over a private Unix socket, **Go to window** brings the session's app to the front, and the
  shortcuts use ⌃ Control and ⌥ Option. Quiet in full screen isn't available on macOS yet.
- **Release builds** from GitHub Actions for both systems, with `SHA256SUMS.txt` published next to
  the Windows installer and the macOS disk image.

### Security

- The hold for HIGH and CRITICAL requests, and the cap that keeps them from ever being approved
  automatically, are enforced in Rust; a hand-edited settings file can't lift the cap. Session
  grants obey the same auto-allow ceiling as rules and trusted projects.
- Approvals must come from a physical mouse click on the Allow button: Windows Raw Input tells
  real presses from clicks synthesised with `SendInput` and from UI Automation invokes, and on
  macOS the event's source process tells a real mouse or trackpad from posted events and
  accessibility presses; anything else is refused and shown on the card. Each real press backs exactly one approval. The guard only listens while a request is waiting, and can be switched off for
  accessibility tools.
- The channel between the relay and the app is yours alone: on Windows a per-user named pipe with
  an explicit DACL (your account and SYSTEM only) that rejects remote clients, on macOS a Unix
  socket in a 0700 folder whose peers must run as you. Either way the relay checks that the app
  on the other end runs as you before sending anything.
- Approval payloads up to 64 KiB travel whole; anything longer is flagged and scored HIGH, never
  shortened silently. Invisible and bidirectional characters, and long runs of blank lines or
  spaces, are made visible on the card, and a command box that scrolls says so.
- Request text is never rendered as HTML.
- Secrets — API keys and tokens, `Authorization` headers, password-style values, credentials in
  URLs and private keys — are masked in the history and in notifications. The approval
  card always shows the request in full.
- The CSV export defuses spreadsheet formulas.
- No network access, no telemetry, no stored secrets.

## 0.1.0 - 2026-10-01

Internal builds, never released publicly. They introduced the island and the owl, per-session
tracking with an approval queue, the first risk engine with press-and-hold for HIGH and CRITICAL
requests, approval payloads that are never cut silently, and a Turkish-only interface. The named
pipe relay, the reviewed-diff hook installer and the island window were adapted from
[Coucou](https://github.com/Louis-CFM/coucou) (MIT). Everything they had, and much more, shipped
publicly in 0.2.0.

[Unreleased]: https://github.com/tahap0l/nobetci/compare/v2.1.7...HEAD
[2.1.7]: https://github.com/tahap0l/nobetci/compare/v2.1.6...v2.1.7
[2.1.6]: https://github.com/tahap0l/nobetci/compare/v2.1.5...v2.1.6
[2.1.5]: https://github.com/tahap0l/nobetci/compare/v2.1.4...v2.1.5
[2.1.4]: https://github.com/tahap0l/nobetci/compare/v2.1.3...v2.1.4
[2.1.3]: https://github.com/tahap0l/nobetci/compare/v2.1.2...v2.1.3
[2.1.2]: https://github.com/tahap0l/nobetci/compare/v2.1.1...v2.1.2
[2.1.1]: https://github.com/tahap0l/nobetci/compare/v2.1.0...v2.1.1
[2.1.0]: https://github.com/tahap0l/nobetci/compare/v2.0.2...v2.1.0
[2.0.2]: https://github.com/tahap0l/nobetci/compare/v2.0.1...v2.0.2
[0.2.0]: https://github.com/tahap0l/nobetci/releases/tag/v0.2.0
[2.0.1]: https://github.com/tahap0l/nobetci/compare/v0.2.0...v2.0.1
