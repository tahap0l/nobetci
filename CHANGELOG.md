# Changelog

All notable changes to Nöbetçi are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.4.1] - 2026-11-19

### Changed

- **A new look for the Windows installer.** Dark welcome and finish pages in Nöbetçi's colours, with
  a little island and the owl in the sidebar: it waves on the welcome page and cheers when setup is
  done. New welcome and finish texts in Turkish and English, and the owl in the header of every
  page. The pictures are drawn with the app's own mascot engine (`scripts/installer-art.mjs`).
- **A new look for the macOS disk image too.** The window that opens with the `.dmg` has the
  same night sky, the island and a soft arrow from Nöbetçi to Applications, with the instruction in
  Turkish and English, sharp on Retina screens.

## [2.4.0] - 2026-11-19

### Added

- **Answer Claude's questions on the island.** When Claude asks a multiple-choice question
  (AskUserQuestion), the card shows every question with its options; pick one or several, or
  write your own answer, and send. Works in the terminal, VS Code and the Claude desktop app.
  **Hand to terminal** gives the question back.
- **Approve plans on the island.** When Claude finishes a plan (ExitPlanMode), the card shows it
  as formatted text. **Approve plan**, or write what to change and **Send back with note**: Claude
  reads the note and keeps planning. Turn both off under **Settings → Claude Code → Questions and
  plans**.
- **Changed files with diffs.** The session view lists every file the session edited or created
  with lines added and removed; click one to read its diff.
- **Context and plan limits.** Tick **StatusLine** under **Settings → Claude Code → Events** and
  the session view shows context use and the session's cost, the island header shows the 5-hour
  limit, and meters show the 5-hour and weekly windows with their reset times. It uses Claude
  Code's own status line (a short line under the prompt), so it is opt-in, and Nöbetçi never
  replaces a status line of yours.
- **Allow all low-risk requests at once.** With two or more LOW requests waiting, one click allows
  them all. Medium and above, questions and plans are never part of it, and the click must be a
  real one when the click guard is on. The history marks them **Batch (low risk)**.

## [2.3.3] - 2026-11-19

### Fixed

- **The Claude desktop app on Windows.** Claude Code runs a hook in Git Bash, or in PowerShell when it
  cannot find Git Bash, which is often the case in the Claude desktop app even when the terminal
  finds it. Nöbetçi wrote its hooks as a quoted path, which PowerShell reads as a plain string, so
  in the app the relay never ran and nothing reached the island. The hooks are now a bare path
  that runs in both shells (the 8.3 short form when the path has spaces).
- **Update the hooks once:** Settings → Claude Code says the hooks are out of date; review the
  change and reinstall, then restart the Claude desktop app.

## [2.3.2] - 2026-11-16

### Fixed

- **Approvals from the Claude desktop app.** The Code tab of the Claude desktop app shows its own
  permission dialog and never runs Claude Code's `PermissionRequest` hook, so its requests never
  reached the island. Nöbetçi now asks from the `PreToolUse` hook there instead: commands, file
  edits, web fetches and MCP tools wait for your decision on the island, with the same risk score,
  hold and real-click guard. Reads never wait, and nothing waits in a mode where the app would not
  ask (Accept edits for file edits, Bypass permissions). With no answer, or with Nöbetçi closed,
  the app's own dialog appears as before. The terminal and VS Code are unchanged.
- **Update the hooks once:** Settings → Claude Code says the hooks are out of date (the
  `PreToolUse` entry gets the same timeout as `PermissionRequest`); review the diff and reinstall.

## [2.3.1] - 2026-11-15

### Added

- **Voice input** in the assistant: the microphone button starts the system's own dictation
  (Windows voice typing, macOS Dictation) into the text box. Nöbetçi never hears the audio.
- **Prompt ideas**: about twenty ready-made prompts in six groups (getting started, writing,
  learning, work, code, everyday), in Turkish and English. Each one shows how a good prompt is
  built; the parts in [brackets] are selected for you, and Tab jumps to the next one.
- **Desktop AI apps first**: when the Claude, ChatGPT, Perplexity or Copilot app is installed, the
  assistant opens the message there instead of the browser (Claude, ChatGPT and Perplexity get the
  text in their box; the app never sends it for you). A green dot marks those targets; switch it
  off under **Settings → General → Assistant**.
- **Agenda**: a small to-do list per day on the island, with an optional time that reminds you
  with a notification (silent during do-not-disturb). The calendar shows dots on busy days and a
  click on a day opens its agenda; the compact island mentions the next item.
- **System card**: processor, memory and graphics load as live rings, with a minute of CPU history.
  Read only while the card is on screen.
- **Focus length**: set the timer from 5 to 120 minutes in Settings, or with − and + on the card.
- **Mascot sizes**: the island's mascot can be 80–130 % of its size; the desktop mascot also
  resizes with Ctrl (⌘) + mouse wheel.

### Changed

- **Weather** shows an animated icon, high and low, feels-like and wind, and the next twelve hours
  in steps of three. One request is shared and reused for ten minutes; 17 more cities.
- **Calendar**: day pills that slide when you change weeks, and a **Today** button.
- **Island motion**: the width opens a moment before the height, content rises out of a light blur
  piece by piece, and a sliding pill marks the selected card. Looping animations only run while
  the island is open.
- The empty island was a little too short for its cards; it now fits them.
- Tauri 2.12.5.

## [2.3.0] - 2026-11-14

### Added

- **Linux.** A `.deb` and an AppImage for x86-64. The island runs on X11 and, through XWayland, on
  Wayland desktops; the relay talks over a Unix socket in `~/.local/state/nobetci` and checks the
  peer's user id; the click guard reads XInput2 raw events and refuses XTEST clicks (`xdotool`);
  quiet in full screen, **Go to window**, start at login and the Secret Service keyring all work.
- **An assistant on the island** (`Ctrl+Alt+Space` or the ✦ button). Write a message and send it to
  ChatGPT, Claude, Gemini, Perplexity, Copilot, Grok, DeepSeek or Mistral: the app opens with the
  message (where it accepts one in its address) and the message is on the clipboard too. **Here**
  answers on the island with the Prompt Studio model. Slash commands (`/pause`, `/dnd`, `/focus 25`,
  `/play`, `/next`, `/prev`, `/settings`, in Turkish too) control Nöbetçi, and ↑/↓ bring back
  earlier messages. The island takes the keyboard only while you type there.
- **A new media card**: the artwork blurred behind the card, a live time bar you can click (or
  move with ←/→) to seek, and larger controls. It now works on all three systems — the system
  media controls on Windows, Spotify and Music on macOS, every MPRIS player on Linux.
- **Mascot size**: make the desktop mascot 60–200 % of its size in **Settings → General → Desktop
  mascot**; it keeps standing where it was.
- Claude Code sessions from the **Claude desktop app** (its Code tab) and from VS Code are named as
  such on the island; the hand-off button reads **Hand to Claude** for them.

### Changed

- **macOS is no longer a beta.** The island is a non-activating panel that never takes focus,
  quiet in full screen works, and the media card follows Spotify and Music.
- A refreshed settings window: ambient light behind a glass sidebar and header, cards with an
  icon chip and a soft sheen, the island's violet as the accent, gentler motion.

### Security

- Update `rustls-webpki` to 0.103.17 (RUSTSEC-2026-0382: certificate checks could accept a
  distrusted intermediate). It is used by the Prompt Studio's OpenAI connection and the weather card.

## [2.2.0] - 2026-11-14

### Added

- A desktop mascot: the island's mascot in a window of its own that you drag anywhere on the
  screen with the mouse. It remembers where you left it (and comes back to a corner if that display
  is gone), spreads its wings while carried and lands with a bounce, shares the island's mood, pokes
  back on a click and opens the island on a double click. It never takes keyboard focus, falls
  asleep after two minutes of calm and then stops drawing. Switch it in **Settings → General →
  Desktop mascot** or from the tray menu; it can also be sent back to its corner from there.
  Decisions are still made only on the island's card.
- New reactions to decisions, for all seven mascots. Approving: smiling eyes and rosy cheeks, two
  nods, two hops with the wings up, and a green tick that draws itself in a burst of sparkles.
  Denying: a frown with narrowed eyes and pinned-back ears, bristling feathers, a head shake, huffs
  of steam and a red cross. Requests a rule denies get the same reaction. The web demo plays them
  too.

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

[Unreleased]: https://github.com/tahap0l/nobetci/compare/v2.4.1...HEAD
[2.4.1]: https://github.com/tahap0l/nobetci/compare/v2.4.0...v2.4.1
[2.4.0]: https://github.com/tahap0l/nobetci/compare/v2.3.3...v2.4.0
[2.3.3]: https://github.com/tahap0l/nobetci/compare/v2.3.2...v2.3.3
[2.3.2]: https://github.com/tahap0l/nobetci/compare/v2.3.1...v2.3.2
[2.3.1]: https://github.com/tahap0l/nobetci/compare/v2.3.0...v2.3.1
[2.3.0]: https://github.com/tahap0l/nobetci/compare/v2.2.0...v2.3.0
[2.2.0]: https://github.com/tahap0l/nobetci/compare/v2.1.7...v2.2.0
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
