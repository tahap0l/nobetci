# Contributing to Nöbetçi

Thanks for helping the owl keep watch. Bug reports, false positives, new risk rules, translations
and code are all welcome.

Before you start:

- **Security problems** go through private reporting, not issues — see [SECURITY.md](SECURITY.md).
- **A command scored too high or too low?** Open a
  [risk rule issue](https://github.com/tahap0l/nobetci/issues/new?template=risk_rule.yml). That's
  one of the most useful contributions there is.
- **Bigger changes** (new features, new dependencies, changes to the relay or the pipe protocol):
  please open an issue first, so we can agree on the approach before you spend time on it.
- Everyone taking part is expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

Code, comments, commit messages and pull requests are in English. Issues and discussions are
welcome in English or Turkish.

## Setting up

On **Windows 10 or 11** (64-bit) you need:

- [Rust](https://rustup.rs), stable, with the MSVC toolchain (`rustup` installs it by default);
- Node.js 22 or newer (CI uses 22);
- the [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with
  the "Desktop development with C++" workload;
- the Microsoft Edge WebView2 runtime (already part of Windows 11 and current Windows 10).

On **macOS 11 or later** you need:

- the Xcode Command Line Tools (`xcode-select --install`);
- [Rust](https://rustup.rs), stable, plus both Apple targets for the universal build:
  `rustup target add aarch64-apple-darwin x86_64-apple-darwin`;
- Node.js 22 or newer.

On **Linux** (x86-64) you need Rust, stable, Node.js 22 or newer and the WebKitGTK development
packages; on Debian and Ubuntu:

```sh
sudo apt install libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev libxi-dev libxdo-dev libdbus-1-dev libssl-dev
```

To build the AppImage with working sounds, add `patchelf` and the GStreamer plugins it carries:
`gstreamer1.0-plugins-base gstreamer1.0-plugins-good gstreamer1.0-pulseaudio gstreamer1.0-alsa`
(see the Linux job in [`.github/workflows/ci.yml`](.github/workflows/ci.yml)).

Then, on any of them:

```sh
git clone https://github.com/tahap0l/nobetci.git
cd nobetci
npm ci
node scripts/build-relay.mjs
```

Why build the relay first? The platform config (`src-tauri/tauri.windows.conf.json`,
`tauri.macos.conf.json` or `tauri.linux.conf.json`) bundles `target/release/nobetci-hook(.exe)` into
the app, and the app's build script stops if the file isn't there — so on a fresh clone,
`cargo clippy` fails until it exists. `npm test`, `npm run dev`, `npm run tauri dev`,
`npm run build` and the `pack` scripts build it for you, which also means they all need Rust.

A custom `CARGO_TARGET_DIR` (or a `target-dir` in a cargo config) works: the relay still goes to
`<repo>/target/release`, where the bundle configs look for it, and `scripts/pack.mjs` finds the
bundles wherever cargo put them. On a Mac, every bundle — not just `npm run pack:mac` — makes the
disk image's background first, so a fresh clone can run `npm run tauri build` directly.

`cargo build --release` on its own makes a *development* build of the app: without Tauri's
`custom-protocol` feature the app loads its pages from the dev server at `http://localhost:1420`,
and with no dev server running the island shows only "Could not connect to localhost". For a real
app without an installer, run `npm run tauri build -- --no-bundle`, which builds the pages into
`dist/` and turns the feature on, or do the same by hand:

```sh
npm run build                                                      # the relay, then the pages into dist/
cargo build --release -p nobetci --features tauri/custom-protocol  # → target/release/nobetci
```

The `pack` scripts build the app the same way before they bundle it.

## Everyday commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Builds the relay (so it needs Rust), then serves the UI alone in a browser at `http://127.0.0.1:1420`, with demo data. |
| `npx vite` | The same browser preview without building the relay: no Rust involved. |
| `npm run tauri dev` | The real app (debug build) with live reload. |
| `npm test` | Every Rust test: risk engine, rules, history, relay, hooks installer, redaction, quiet hours… |
| `npm run lint` | `cargo clippy --workspace --all-targets -- -D warnings`, then `tsc --noEmit`. |
| `npm run fmt` | `cargo fmt --all` (settings in `rustfmt.toml`: 120 columns). |
| `npm run check:invisible` | Fails if any text file git tracks — source, scripts, `.nsi`, `.ps1`, `.xml`, `.plist` and the rest — contains zero-width, bidirectional or other invisible or control characters. |
| `npm run pack` | Windows: builds the installer into `release\Nobetci-<version>-setup.exe`. |
| `npm run pack:store:offline` | Windows: the Microsoft Store variant with the offline WebView2 installer, into `release/store/` (see [docs/microsoft-store.md](docs/microsoft-store.md)). |
| `npm run pack:mac` | macOS: builds the universal disk image into `release/Nobetci-<version>-macos-universal.dmg`. |
| `npm run pack:linux` | Linux: builds the `.deb` and the AppImage into `release/`. |
| `npm run icons` | Regenerates `src-tauri/icons` from the owl's geometry in code. |
| `npm run screenshots` | Renders the README images into `docs/media/<lang>/` (see below). |

Before you open a pull request, run what CI runs:

```powershell
npm run check:invisible
npx tsc --noEmit
cargo fmt --all --check
npm run lint
npm test
```

CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs the same checks as separate steps
on `windows-latest` and, apart from formatting and the front-end checks, on `macos-latest` and
`ubuntu-22.04`, then builds the Windows installer, the macOS disk image and the Linux packages and
keeps them as workflow artifacts; on Linux it also checks that the AppImage carries its audio
plugins. Code that only one OS compiles is easy to break from the others: if you touch
`#[cfg(windows)]`, `#[cfg(target_os = "macos")]` or `#[cfg(target_os = "linux")]` code, check CI's
run on all three. A separate workflow ([`.github/workflows/audit.yml`](.github/workflows/audit.yml))
runs `cargo audit` whenever the Rust dependencies change and once a week.

## Trying changes without Claude Code

**In the browser** (`npm run dev`, or `npx vite` without Rust):

- `/?demo=critical` shows the island with fake sessions and requests. The other demos are `low`,
  `medium` (a MEDIUM card that a rule wanted to allow), `write`, `hidden` (whitespace obfuscation),
  `deny-menu`, `batch`, `question`, `plan`, `overview`, `session`, `assistant`, `compact`, `empty`,
  `tour`, `mascots` (all seven mascots side by side), `reactions` and `installer-art` (the Windows
  installer's pictures, which `scripts/installer-art.mjs` captures). `&theme=wolf` (or any other
  mascot) picks the mascot, `&media=1` fills the media card (`&media=art` with artwork), and
  `&still=1` holds the scene still for screenshots.
- `/settings.html?tab=kurallar` opens Settings with mock data. Tabs: `genel`, `claude`, `chatgpt`,
  `ajanlar`, `prompts`, `guvenlik`, `kurallar`, `bildirimler`, `gecmis`, `hakkinda`, plus
  `hosgeldin` for the welcome wizard. The mock in `src/settings/mock.ts` takes extra switches to
  show error and edge states (`?relay=missing`, `?loadError=1`, `?foreignStatus=1`…); look for
  `devParam()` calls and the list at the top of that file.
- Add `&lang=en` or `&lang=tr` to either. In Settings, `&platform=macos` or `&platform=linux` shows
  the Mac or Linux wording; the island follows the browser's own system.
- In the console, `nobetci.inject({ … })` feeds the island a fake hook event.

**Against the real app**, pipe an event into the relay, exactly as Claude Code would. A
permission request waits for your decision on the island and prints the answer. On Windows, from
PowerShell:

```powershell
$event = @{
  hook_event_name = "PermissionRequest"
  session_id      = "demo"
  cwd             = "C:\Users\you\src\demo"
  tool_name       = "Bash"
  tool_input      = @{ command = "git push --force origin main" }
} | ConvertTo-Json -Compress

$event | & "$env:LOCALAPPDATA\Nobetci\bin\nobetci-hook.exe" PermissionRequest
```

On macOS, from Terminal:

```sh
echo '{"hook_event_name":"PermissionRequest","session_id":"demo","cwd":"/Users/you/src/demo","tool_name":"Bash","tool_input":{"command":"git push --force origin main"}}' \
  | ~/Library/Application\ Support/Nobetci/bin/nobetci-hook PermissionRequest
```

On Linux, the same with `~/.local/share/nobetci/bin/nobetci-hook`. To see what Cursor would get,
feed the relay Cursor's own shape of event and put `cursor` before the event name (`codex` works
the same way for Codex):

```sh
echo '{"conversation_id":"demo","command":"git push --force origin main","workspace_roots":["/home/you/src/demo"]}' \
  | ~/.local/share/nobetci/bin/nobetci-hook cursor beforeShellExecution
```

If you use Claude Code to work on Nöbetçi: its sandboxed Bash tool may not reach the pipe or
socket (the relay's same-user check refuses it there), so run these from a normal terminal.

### Screenshots

`npm run screenshots` drives headless Microsoft Edge against a running dev server and writes every
README image in English and Turkish into `docs/media/en/` and `docs/media/tr/`. On macOS and
Linux, point `NOBETCI_EDGE` at Edge, Chrome or Chromium. Text is set in the system font, so
regenerate every image on the same system to keep them alike, and at the same scale: the README
shows them at 2× (`NOBETCI_SCALE=2`), and an image taken at 1× next to them looks blurred and
sits at a different height. The island demos are held still (`&still=1`) and Settings is captured
with reduced motion, so nothing is caught half-faded:

```powershell
npm run dev                                  # terminal 1
$env:NOBETCI_SCALE = "2"                     # terminal 2 (sh: export NOBETCI_SCALE=2)
npm run screenshots                          # everything
node scripts/screenshots.mjs tr critical     # just some languages and images
```

Set `NOBETCI_URL` if your dev server isn't on `http://127.0.0.1:1420`, `NOBETCI_EDGE` if Edge
isn't in its usual place, and `NOBETCI_OUT` to write somewhere other than `docs/media`. Pair
images of the same shape in the README (the island views are 720×460, the dashboard views 16:9),
and describe in the alt text what is actually in the frame.

## Where things live

```text
hook/src/main.rs       the relay: reads a hook event, forwards it, prints Claude Code's (Codex's, Cursor's) answer
hook/src/win.rs        Windows: our SID, the pipe server's owner, the parent-process chain
hook/src/mac.rs        macOS: the socket, its owner and peer, the parent-process chain
hook/src/linux.rs      Linux: the same, with SO_PEERCRED
hook/src/browser.rs    the ChatGPT Web bridge's native-messaging host
src-tauri/src/
  risk.rs              risk engine: rule tables, categories, tests
  risk/shell.rs        the reading of shell commands: what runs, what gets written where
  risk/regression.rs   the audit's cases, each pinned to the level it must get
  rules.rs             user rules, project trust, session grants, the auto-allow ceiling
  pipe.rs              the relay server: decisions, the hold rule, the batch and the hotkey
  pipe/named_pipe.rs   Windows: the pipe and its DACL
  pipe/unix_socket.rs  macOS and Linux: the socket, its folder's permissions, the peer check
  inputguard.rs        physical-click guard: the decision
  inputguard/          raw_input.rs (Windows Raw Input) · appkit.rs (macOS event source) · x11.rs (XInput2)
  sys.rs               small per-OS helpers: clock, language, full screen, home folder
  redact.rs            secret masking for the history and notifications
  audit.rs             history: append, query, statistics, CSV/JSON export
  hooks.rs             ~/.claude/settings.json: preview, backup, install, removal
  agent_hooks.rs       the same for Codex and Cursor
  settings.rs          preferences, defaults and the limits they're clamped to
  i18n.rs              Turkish/English for text produced in Rust
  widgets.rs · widgets/  media (SMTC, MPRIS, AppleScript), system load, weather
  agenda.rs · assistant.rs · prompts.rs · buddy.rs
  island.rs · quiet.rs · focus.rs · hotkeys.rs · tray.rs · x11.rs · mac_panel.rs · lib.rs
src/
  ui/views.ts          island views, including the approval card
  ui/interactive.ts    the question and plan cards
  island/              state machine, hook event handling, geometry
  baykus/              the mascots (Canvas 2D)
  buddy/               the desktop mascot
  core/                app state, the bridge to Rust, synthesised sounds
  i18n/                i18n core and the island's strings
  settings/            the settings window, its tabs, strings and mock data
website/               the website (GitHub Pages)
scripts/               packaging, icons, screenshots, the invisible-character check
```

## The ground rules

These are what make Nöbetçi trustworthy. A change that breaks one of them won't be merged, however
useful it is otherwise.

### 1. Never block Claude Code

Claude Code runs the relay on every hook event, so the relay must be fast and must give up
gracefully. If the app isn't running, the relay exits at once without output. It waits for a busy
pipe for at most 300 ms, and an event nobody waits on gets a hard 2-second budget. Only a
permission request waits for an answer, and only once the island has confirmed that the card is
on screen or queued (800 ms); the app lets go after 108 s and the relay after 110 s. Every
failure ends the same way: no output, and Claude Code asks in the terminal. For Cursor, "no
decision" is an explicit `ask`, so Cursor asks the user itself; its hooks stay fail-closed for a
relay that can't run.

Two kinds of `PreToolUse` wait like a permission request, with the same budget: in the Claude
desktop app, which never runs `PermissionRequest`, a tool that would ask (`desktop_gate` in
`hook/src/main.rs`; it also holds calls Claude's own allow list would have let through — a
documented trade-off, silence falls back to the app's own behaviour), and Claude's
`AskUserQuestion` and `ExitPlanMode` everywhere (`interactive_tool`), which only a person answers.

Keep every blocking call in the relay under the main thread's deadline, and keep the relay lean —
it starts once per event.

### 2. Never write `~/.claude/settings.json` without a reviewed diff

The file belongs to the user and may hold other tools' hooks. Any write takes a dated backup,
merges without touching anything that isn't Nöbetçi's, shows the diff, happens only after an
explicit click, writes exactly what the preview showed, and is refused if the file changed since
the preview. A file that can't be read or parsed is never overwritten. Codex's and Cursor's
`hooks.json` get the same treatment (`agent_hooks.rs`). The only exception is
`nobetci --remove-hooks` — the Windows uninstaller runs it, and people run it by hand on macOS
and Linux — which removes nothing but Nöbetçi's own hook commands (never a foreign hook that
shares a matcher group), keeps the file's key order, writes through a symlink, still keeps a dated
backup, and exits non-zero if anything is left. The risk engine scores any command that runs it as
CRITICAL. The tests in `hooks.rs` and `agent_hooks.rs` guard this; extend them when you touch it.

### 3. HIGH and CRITICAL always need a person

- A HIGH or CRITICAL approval needs a hold, and that is enforced in `pipe.rs` (`resolve`), not
  only in the UI. Never add an "always allow".
- Nothing HIGH or CRITICAL is approved automatically: rules, trusted projects and session grants
  are capped in `rules.rs`, and `auto_allow_max` can't go above `medium` (`settings.rs` sanitises
  it). The cap looks at the engine's own level too. Rules may always deny.
- Approvals from the island must be backed by a physical click (`inputguard.rs`, checked in
  `pipe::answer`) that began after the card was shown; a card accepts nothing in its first 350 ms
  (`approval_shown`). Keep those checks.
- The allow hotkey stays LOW-only — by the engine's own level as well as the current one — and
  Rust accepts it only right after a real press of the shortcut. Batch approval covers LOW only,
  the same way, only the requests the island listed, with one physical click
  (`pipe::allow_low`); never medium or above, never a question or a plan.

### 4. No `innerHTML`

The approval card shows text an attacker may control, in a window that can approve commands. Build
the DOM with `h()` (`src/ui/dom.ts`) and text nodes only — no `innerHTML`, `outerHTML`,
`insertAdjacentHTML` or `document.write`, in the island or in Settings.

### 5. What the card shows is what runs

Never shorten an approval payload silently. When the relay has to cut something, it sets
`nobetci_truncated` and the request becomes HIGH. Invisible characters and long runs of
whitespace are made visible on the card; keep it that way.

### 6. Every decision is recorded, safely

Every permission request outcome is written to the history (`audit.rs`), including timeouts,
requests handed to the terminal, questions and plans handed straight back, requests too large for
the channel, and answers that never reached the relay. Text that outlives the card — the history
and desktop notifications — goes through `redact::redact`; the card itself always shows the
request in full. The CSV export must stay formula-safe.

### 7. One place knows Claude Code's format

The relay and the app speak a small JSON line
(`{"behavior":"deny","message":…,"interrupt":…,"stop":…}`). Only `hook/src/main.rs` knows Claude
Code's, Codex's and Cursor's hook output formats. The app always sends `interrupt` explicitly: a
plain deny — the button, a reason, the hotkey or a rule — is `false`, so Claude reads the message
and carries on; **Deny and stop Claude** is `true` with `stop: true`.

### 8. No telemetry; network only when the user switches it on

No analytics, crash reporters or update checks. Prompt Studio may use local Ollama or the OpenAI
API only after the user selects a provider and asks for a rewrite (the island assistant's **Ask
here** uses the same provider); the weather card asks Open-Meteo only once a city is picked; the
assistant's other targets only open a fixed `https://` address from `assistant.rs`. Keep drafts
out of logs, settings and history; keep the optional OpenAI key in the OS credential store.

### 9. Idle means idle

A hidden island uses no CPU to speak of: the frame loop stops, the cursor poll parks, and the
click guard only listens while a request is waiting. A resting island lets the owl fall asleep
after three calm minutes, and then stops drawing too. Don't add timers or polling that run while
the island is hidden, and keep looping CSS animations inside `#island[data-mode="expanded"]`.

### 10. Original assets only

The owl, the icons and the sounds are Nöbetçi's own. Sounds are synthesised in code
(`src/core/sound.ts`) and the icons are generated by `scripts/gen-icons.mjs`. Don't import
anything from Coucou's Mochi character, icons or sounds: they are not MIT-licensed.

### 11. Turkish and English, everywhere

Every user-visible string exists in both languages:

- **front end** — strings go through `defineMessages(tr, en)` from `src/i18n/core.ts`. The
  island keeps a Turkish and an English table in `src/i18n/island.ts`, and the type system
  rejects an English table that misses a Turkish key; the settings window keeps each string as a
  `[Turkish, English]` pair in `src/settings/i18n.ts`. Wording that differs on a Mac or on Linux
  goes in a `key@mac` / `key@linux` entry next to the key, and an English singular in `key#one`;
- **Rust** — use `i18n::pick(en, tr)` for anything the user or Claude will read: risk labels,
  rule notes, errors, the tray menu, denial messages.

The documentation follows the same rule where people read it to use the app: the README, the
installation guide, the privacy and code signing policies exist in both languages.

If you don't speak Turkish, write the English and say so in the pull request; a maintainer will
help with the translation.

### 12. No invisible characters in the source

Nöbetçi flags zero-width, bidirectional and other invisible control characters as an obfuscation
trick, so its own files must be free of them. If a test or a pattern needs one, write it as a
Unicode escape sequence, never as the raw character. `npm run check:invisible` (and CI) scans
every text file git tracks and will tell you.

### 13. Three platforms

OS-specific code lives behind `#[cfg(windows)]`, `#[cfg(target_os = "macos")]` and
`#[cfg(target_os = "linux")]` in its own module (`hook/src/{win,mac,linux}.rs`,
`pipe/{named_pipe,unix_socket}.rs`, `inputguard/{raw_input,appkit,x11}.rs`, …); shared logic stays
shared, and every rule above holds on all three.

## Proposing a risk rule or reporting a false positive

The quickest way is the [risk rule issue template](https://github.com/tahap0l/nobetci/issues/new?template=risk_rule.yml):
the exact command, path or URL, the tool, the level you expected, the level Nöbetçi gave, and why.
You can check what it gives today in **Settings → Safety**, which has a tester.

To send a pull request instead:

1. Add the rule to the right table in `src-tauri/src/risk.rs`: `COMMAND_RULES`,
   `WRITE_PATH_RULES`, `CONTENT_RULES`, `READ_PATH_RULES` or `WEB_RULES`. Each rule has a stable
   category id, a level, a Turkish and an English label, a tag (`Secret` or `Exfil` if it is one
   half of a leak) and a regular expression. Patterns are matched case-insensitively by Rust's
   `regex` crate, which has no look-around or back-references. What a pattern can't see — which
   file a shell command writes, what runs after a download, what a pipe feeds an interpreter —
   is read in `src-tauri/src/risk/shell.rs`, and write paths are resolved against the session's
   folder before any path rule runs.
2. Pick the lowest level that is honest:
   - **CRITICAL** — hard or impossible to undo, or a classic attack shape;
   - **HIGH** — deliberate, visible or persistent;
   - **MEDIUM** — worth a glance;
   - **LOW** — context, not alarm.

   Err on the side of noise only for what is hard to undo — deleting, publishing, persisting,
   leaking secrets — and stay quiet for everyday development.
3. Add tests in `risk.rs`: one showing the risky command gets the level, and a **"stays low"
   case** showing that everyday commands that look similar don't trip it (add them to
   `everyday_commands_stay_low` or write a new test). A case reported in an issue belongs in
   `risk/regression.rs` too, with the level it must get end to end; its
   `everyday_development_stays_low` list is the other side of the same promise.
4. Run `npm test`. `categories_are_listed_and_switchable` makes sure every category shows up
   exactly once in Settings.

## Commits and pull requests

- Keep pull requests small and about one thing.
- Write commit messages in English, in the imperative ("Flag `certutil -decode`"), and explain
  *why* in the body when it isn't obvious.
- Fill in the pull request template. For UI changes, include before-and-after screenshots in both
  languages; the demo URLs and `npm run screenshots` make that quick.
- Add a line to the **Unreleased** section of [CHANGELOG.md](CHANGELOG.md) for anything a user
  would notice. Leave version numbers alone; they change at release time.
- CI must be green on Windows, macOS and Linux: invisible characters, typecheck, rustfmt, clippy
  with warnings as errors, tests and the package builds.
- If you change what a user does or sees, update the README, the installation guide and, where it
  applies, `SECURITY.md` and `PRIVACY.md` — in both languages where the document has both.

By contributing, you agree that your contribution is licensed under the [MIT License](LICENSE),
like the rest of the project.

## Releasing (maintainers)

1. Bump the version in `package.json` (`npm version <x.y.z> --no-git-tag-version` updates
   `package-lock.json` too), in `[workspace.package]` in `Cargo.toml`, and in
   `src-tauri/tauri.conf.json`. Run `cargo check` so `Cargo.lock` follows.
2. Move the **Unreleased** entries in `CHANGELOG.md` into a new `## [x.y.z] - YYYY-MM-DD` section
   and update the comparison links at the bottom.
3. Commit, and get the commit onto `main`.
4. Start the release by hand: **Actions → Release → Run workflow**, on `main`, with the tag
   `vx.y.z`. Don't push the tag yourself: the workflow creates it on the commit it built. This is
   the only release path — it is the one the [code signing policy](CODE_SIGNING_POLICY.md)
   describes, and SignPath signs only for `main`.

The [release workflow](.github/workflows/release.yml) checks that the tag matches all three
versions, builds and tests everything on Windows, macOS and Linux, has the Windows programs and
then the installer signed (once SignPath is switched on) and the macOS app signed and notarized
(once there is an Apple Developer ID), writes `SHA256SUMS.txt`, and publishes a GitHub release
with that version's CHANGELOG section as its notes. The notes also say whether the release's
files are signed and notarized. Every file is published twice: with the version in its name, and
without it (`Nobetci-setup.exe`, `Nobetci-macos-universal.dmg`, `Nobetci-linux-amd64.deb`,
`Nobetci-linux-amd64.AppImage`), so a page can link to the newest one through
`releases/latest/download/<name>`. A tag with a `-` in it (for example `v0.3.0-beta.1`) becomes a
pre-release; its notes may come from **Unreleased**. A run from another branch builds and tests
everything but publishes nothing.

If the tag or the release already exists, the run stops rather than publish files built from
another commit. To rebuild a published version without a new number, run it again with
**replace**: the tag moves to the commit just built and the release's files and notes are
replaced (or the release is created, if only the tag was there).
