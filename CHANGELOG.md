# Changelog

All notable changes to Nöbetçi are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/tahap0l/nobetci/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/tahap0l/nobetci/releases/tag/v0.2.0
