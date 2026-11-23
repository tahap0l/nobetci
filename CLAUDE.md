# Nöbetçi — guide for AI coding agents

Tray / menu bar app for Windows, macOS and Linux (Tauri 2: Rust + TypeScript, no frontend framework). An owl on a
black island at the top of the screen shows Claude Code sessions and lets the user
approve permission requests, each scored by a risk engine.

## Build & test
- `npm test` — Rust unit tests (risk engine, rules, history, relay, decision rules, quiet hours). Run after any change to `src-tauri/src/*.rs` or `hook/`. Builds on all three OSes; on Linux it needs the WebKitGTK, libxi and libdbus dev packages (see README).
- `npx tsc --noEmit` — typecheck the front end.
- `npm run dev` (or `npx vite`, which skips building the relay) then `http://127.0.0.1:1420/?demo=<critical|medium|low|write|hidden|deny-menu|batch|question|plan|overview|session|assistant|compact|empty|tour|mascots|reactions|installer-art>` (`&theme=<mascot>` picks the mascot, `&lang=<tr|en>` the language) — island without the Rust app; `settings.html?tab=<id>` — settings with mock data.
- Claude's own Bash tool is sandboxed: the relay's same-user check refuses the pipe there. Feed fake hook events from PowerShell.
- `npm run pack` — Windows installer into `release/`; `npm run pack:mac` — universal macOS disk image (on a Mac); `npm run pack:linux` — .deb and AppImage. CI builds and tests all three OSes.

## Rules
- **Never block Claude Code.** The relay exits silently if the app is closed; only PermissionRequest waits, and never past its budget. The one exception: in the Claude desktop app (`CLAUDE_CODE_ENTRYPOINT=claude-desktop`), which never runs PermissionRequest hooks, the relay turns a PreToolUse for a tool that would ask into a permission request (`desktop_gate` in `hook/src/main.rs`) — same budget, silence falls back to the app's own dialog. The relay also waits on a PreToolUse for Claude's AskUserQuestion and ExitPlanMode in every surface (`interactive_tool`): only the user answers them (never a rule), the reply echoes the input in `updatedInput`, and a cut input is never answered.
- **Batch approval covers LOW only** (`pipe::allow_low`): never medium or above, never a question or plan, one physical click for the lot.
- The status line (`nobetci-hook statusline`) is opt-in (the `StatusLine` pseudo-event), never waits on the app, and never replaces a `statusLine` that isn't ours.
- **Never write `~/.claude/settings.json` without a reviewed diff**: dated backup, merge, show the diff, write only after an explicit click, refuse if the file changed since the preview.
- **High/critical approvals need a hold** — enforced in `pipe.rs::resolve`, not just the UI. Never add an "always allow".
- **Nothing high or critical is ever auto-approved** — rules, trusted projects and session grants are capped in `rules.rs` (`auto_allow_max` ≤ medium, sanitised in `settings.rs`). The cap looks at the engine's own level too: a rule that re-scores a high request to low makes it a plain click, never an automatic pass. Rules may always deny.
- Every PermissionRequest outcome is written to the history (`audit.rs`); CSV export must stay formula-safe.
- Relay ↔ app speak a small JSON line (`{"behavior":"deny","message":…,"interrupt":…,"stop":…}`); only `hook/src/main.rs` knows Claude Code's output format.
- **No innerHTML.** The approval card shows attacker-controllable text in a window that can approve commands. Build DOM with `h()` / text nodes only.
- What the card shows must be what runs: never truncate approval payloads silently (`nobetci_truncated` flag → high risk). The assessment's `target` is the whole command, path, URL or argument object — rules and session grants match on it.
- No telemetry. Network access is limited to things the user switches on: an explicit Prompt
  Studio provider call — Ollama on loopback (cloud-tagged models may forward the draft) or OpenAI
  after the user selects it and asks for a rewrite, or asks the island's assistant with **Here** —
  and the island's weather card, which asks Open-Meteo for the chosen city's forecast (off until a
  city is picked). The assistant's other targets only open a fixed `https://` address from
  `assistant.rs`'s table through `sys::open_url` (http(s) only); Nöbetçi itself sends nothing.
- The assistant may open a desktop AI app only through the fixed links in `assistant.rs`'s `APPS`
  table (`sys::open_app_link`, never http/file schemes), and only when the scheme's handler name
  matches. Dictation is the OS's own (Win+H, `startDictation:`); Nöbetçi never records audio.
- The system card (`widgets/stats.rs`) and media are polled only while their card is on screen;
  looping CSS animations are scoped to `#island[data-mode="expanded"]`.
- The agenda (`agenda.rs`) lives in `agenda.json` next to the settings; reminders respect quiet
  hours and go through `redact::redact`.
- Media cards read the OS's own sources (SMTC, MPRIS, AppleScript to an app that is already
  running) and never download artwork: only local files or data the player hands over. Optional API keys stay in
  the OS credential store, never settings JSON, logs or audit. Drafts and rewrites are not persisted.
- 0 % CPU while hidden: the frame loop stops and the cursor poll parks.
- The owl, icons and sounds are original. Do not import anything from Coucou's Mochi, icons or sounds (not MIT).
- **Every user-visible string exists in Turkish and English.** Front end: `defineMessages(tr, en)` from `src/i18n/core.ts` (island strings in `src/i18n/island.ts`, settings strings under `src/settings/`); Rust: `i18n::pick(en, tr)`. The language follows the `language` setting ("auto" = the system language). Wording that differs on a Mac or on Linux goes in a `key@mac` / `key@linux` entry next to the key. Code comments are English.
- **The desktop mascot (`buddy.rs`, `src/buddy/`) only shows.** It mirrors the island's mood and reactions over `buddy-*` events and opens the island on a double click; it never answers a request. Its window never takes focus, and its position belongs to Rust (`store()` keeps `buddy_pos`).
- **Approvals need a physical click** (`inputguard.rs`): Raw Input on Windows and the event's source pid on macOS tell real presses from synthesised ones and accessibility "presses"; Linux's XInput2 check stops XTEST-device clicks but not a click a program presses through the real mouse, so `inputguard::vouches_for_holds()` is false there and `pipe.rs::resolve` refuses every island allow of a HIGH/CRITICAL request with `terminal_only` (those are decided in the terminal). Keep the check in `pipe::answer`; the allow hotkey stays LOW-only.
- **Three platforms.** OS-specific code lives behind `#[cfg(windows)]` / `#[cfg(target_os = "macos")]` / `#[cfg(target_os = "linux")]` in its own module (`hook/src/{win,mac,linux}.rs`, `pipe/{named_pipe,unix_socket}.rs`, `inputguard/{raw_input,appkit,x11}.rs`, `widgets/{linux,mac}_media.rs`, `x11.rs`, `mac_panel.rs`, `sys.rs`); shared logic stays shared. Every rule above holds on all three. Linux runs the window on X11 (XWayland under Wayland: `GDK_BACKEND=x11`) so the island can place itself and the click guard can see XInput2 raw events; presses from XTEST devices count as synthetic, but XTEST can also press through the real mouse, so on Linux the guard is a speed bump for LOW/MEDIUM and HIGH/CRITICAL are approved only in the terminal.
- Text that outlives the card (history, notifications) goes through `redact::redact`; the card itself always shows the request in full.
- No literal invisible or bidi characters in source files — write them as escapes (`\u200B`). The repo is scanned for them.
- New risk rules come with tests in `risk.rs`, including a "stays low" case for everyday commands.
