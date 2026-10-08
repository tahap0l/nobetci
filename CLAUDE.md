# Nöbetçi — guide for AI coding agents

Tray / menu bar app for Windows and macOS (Tauri 2: Rust + TypeScript, no frontend framework). An owl on a
black island at the top of the screen shows Claude Code sessions and lets the user
approve permission requests, each scored by a risk engine.

## Build & test
- `npm test` — Rust unit tests (risk engine, rules, history, relay, decision rules, quiet hours). Run after any change to `src-tauri/src/*.rs` or `hook/`.
- `npx tsc --noEmit` — typecheck the front end.
- `npm run dev` then `http://127.0.0.1:1420/?demo=<critical|write|low|overview|session|compact|empty>` — island without Rust; `settings.html?tab=<id>` — settings with mock data.
- Claude's own Bash tool is sandboxed: the relay's same-user check refuses the pipe there. Feed fake hook events from PowerShell.
- `npm run pack` — Windows installer into `release/`; `npm run pack:mac` — universal macOS disk image (on a Mac). CI builds and tests both OSes.

## Rules
- **Never block Claude Code.** The relay exits silently if the app is closed; only PermissionRequest waits, and never past its budget.
- **Never write `~/.claude/settings.json` without a reviewed diff**: dated backup, merge, show the diff, write only after an explicit click, refuse if the file changed since the preview.
- **High/critical approvals need a hold** — enforced in `pipe.rs::resolve`, not just the UI. Never add an "always allow".
- **Nothing high or critical is ever auto-approved** — rules, trusted projects and session grants are capped in `rules.rs` (`auto_allow_max` ≤ medium, sanitised in `settings.rs`). Rules may always deny.
- Every PermissionRequest outcome is written to the history (`audit.rs`); CSV export must stay formula-safe.
- Relay ↔ app speak a small JSON line (`{"behavior":"deny","message":…,"interrupt":…,"stop":…}`); only `hook/src/main.rs` knows Claude Code's output format.
- **No innerHTML.** The approval card shows attacker-controllable text in a window that can approve commands. Build DOM with `h()` / text nodes only.
- What the card shows must be what runs: never truncate approval payloads silently (`nobetci_truncated` flag → high risk).
- No telemetry, no network calls, no secrets stored.
- 0 % CPU while hidden: the frame loop stops and the cursor poll parks.
- The owl, icons and sounds are original. Do not import anything from Coucou's Mochi, icons or sounds (not MIT).
- **Every user-visible string exists in Turkish and English.** Front end: `defineMessages(tr, en)` from `src/i18n/core.ts` (island strings in `src/i18n/island.ts`, settings strings under `src/settings/`); Rust: `i18n::pick(en, tr)`. The language follows the `language` setting ("auto" = the system language). Wording that differs on a Mac goes in a `key@mac` entry next to the key. Code comments are English.
- **Approvals need a physical click** (`inputguard.rs`): Raw Input on Windows, the event's source pid on macOS, tell real presses from synthesised ones and accessibility "presses". Keep the check in `pipe::answer`; the allow hotkey stays LOW-only.
- **Two platforms.** OS-specific code lives behind `#[cfg(windows)]` / `#[cfg(target_os = "macos")]` in its own module (`hook/src/{win,mac}.rs`, `pipe/{named_pipe,unix_socket}.rs`, `inputguard/{raw_input,appkit}.rs`, `sys.rs`); shared logic stays shared. Every rule above holds on both.
- Text that outlives the card (history, notifications) goes through `redact::redact`; the card itself always shows the request in full.
- No literal invisible or bidi characters in source files — write them as escapes (`\u200B`). The repo is scanned for them.
- New risk rules come with tests in `risk.rs`, including a "stays low" case for everyday commands.
