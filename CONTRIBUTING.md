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
- Node.js 20 or newer (CI uses 22);
- the [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with
  the "Desktop development with C++" workload;
- the Microsoft Edge WebView2 runtime (already part of Windows 11 and current Windows 10).

On **macOS 11 or later** you need:

- the Xcode Command Line Tools (`xcode-select --install`);
- [Rust](https://rustup.rs), stable, plus both Apple targets for the universal build:
  `rustup target add aarch64-apple-darwin x86_64-apple-darwin`;
- Node.js 20 or newer.

Then, on either:

```sh
git clone https://github.com/tahap0l/nobetci.git
cd nobetci
npm ci
node scripts/build-relay.mjs
```

Why build the relay first? The platform config (`src-tauri/tauri.windows.conf.json` or
`tauri.macos.conf.json`) bundles `target/release/nobetci-hook(.exe)` into the app, and the app's
build script stops if the file isn't there — so on a fresh clone, `cargo clippy` fails until it
exists. `npm test`, `npm run dev`, `npm run tauri dev` and `npm run build` build it for you.

## Everyday commands

| Command | What it does |
| --- | --- |
| `npm run dev` | The UI alone in a browser at `http://127.0.0.1:1420`, with demo data. No Rust involved. |
| `npm run tauri dev` | The real app (debug build) with live reload. |
| `npm test` | Every Rust test: risk engine, rules, history, relay, hooks installer, redaction, quiet hours… |
| `npm run lint` | `cargo clippy --workspace --all-targets -- -D warnings`, then `tsc --noEmit`. |
| `npm run fmt` | `cargo fmt --all` (settings in `rustfmt.toml`: 120 columns). |
| `npm run check:invisible` | Fails if a tracked text file contains zero-width or bidirectional control characters. |
| `npm run pack` | Windows: builds the installer into `release\Nobetci-<version>-setup.exe`. |
| `npm run pack:mac` | macOS: builds the universal disk image into `release/Nobetci-<version>-macos-universal.dmg`. |
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
on `windows-latest` and, apart from formatting and the front-end checks, on `macos-latest`, then
builds the Windows installer and the macOS disk image and keeps both as workflow artifacts. Code
that only one OS compiles is easy to break from the other: if you touch `#[cfg(windows)]` or
`#[cfg(target_os = "macos")]` code, check CI's run on both.

## Trying changes without Claude Code

**In the browser** (`npm run dev`):

- `/?demo=critical` shows the island with fake sessions and requests. The other demos are `low`,
  `write`, `hidden` (whitespace obfuscation), `deny-menu`, `overview`, `session`, `compact` and
  `empty`.
- `/settings.html?tab=kurallar` opens Settings with mock data. Tabs: `genel`, `claude`,
  `guvenlik`, `kurallar`, `bildirimler`, `gecmis`, `hakkinda`, plus `hosgeldin` for the welcome
  wizard. Some tabs take extra switches for screenshots; look for `devParam()` calls.
- Add `&lang=en` or `&lang=tr` to either, and `&platform=macos` for the Mac wording.
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

If you use Claude Code to work on Nöbetçi: its sandboxed Bash tool may not reach the pipe or
socket (the relay's same-user check refuses it there), so run these from a normal terminal.

### Screenshots

`npm run screenshots` drives headless Microsoft Edge against a running dev server and writes every
README image in English and Turkish into `docs/media/en/` and `docs/media/tr/`:

```powershell
npm run dev                                  # terminal 1
npm run screenshots                          # terminal 2: everything
node scripts/screenshots.mjs tr critical     # just some languages and images
```

Set `NOBETCI_URL` if your dev server isn't on `http://127.0.0.1:1420`, `NOBETCI_EDGE` if Edge
isn't in its usual place, and `NOBETCI_SCALE=2` for high-DPI images.

## Where things live

```text
hook/src/main.rs       the relay: reads a hook event, forwards it, prints Claude Code's answer
hook/src/win.rs        Windows: our SID, the pipe server's owner, the parent-process chain
hook/src/mac.rs        macOS: the socket, its owner and peer, the parent-process chain
src-tauri/src/
  risk.rs              risk engine: rule tables, categories, tests
  rules.rs             user rules, project trust, session grants, the auto-allow ceiling
  pipe.rs              the relay server: decisions and the hold rule
  pipe/named_pipe.rs   Windows: the pipe and its DACL
  pipe/unix_socket.rs  macOS: the socket, its folder's permissions, the peer check
  inputguard.rs        physical-click guard: the decision
  inputguard/          raw_input.rs (Windows Raw Input) · appkit.rs (macOS event source)
  sys.rs               small per-OS helpers: clock, language, full screen, home folder
  redact.rs            secret masking for the history and notifications
  audit.rs             history: append, query, statistics, CSV/JSON export
  hooks.rs             ~/.claude/settings.json: preview, backup, install, removal
  settings.rs          preferences, defaults and the limits they're clamped to
  i18n.rs              Turkish/English for text produced in Rust
  island.rs · quiet.rs · focus.rs · hotkeys.rs · tray.rs · lib.rs
src/
  ui/views.ts          island views, including the approval card
  island/              state machine, hook event handling, geometry
  baykus/              the owl (Canvas 2D)
  core/                app state, the bridge to Rust, synthesised sounds
  i18n/                i18n core and the island's strings
  settings/            the settings window, its tabs, strings and mock data
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
failure ends the same way: no output, and Claude Code asks in the terminal.

Keep every blocking call in the relay under the main thread's deadline, and keep the relay lean —
it starts once per event.

### 2. Never write `~/.claude/settings.json` without a reviewed diff

The file belongs to the user and may hold other tools' hooks. Any write takes a dated backup,
merges without touching anything that isn't Nöbetçi's, shows the diff, happens only after an
explicit click, and is refused if the file changed since the preview. A file that can't be read
or parsed is never overwritten. The only exception is the uninstaller's
`nobetci.exe --remove-hooks`, which removes nothing but Nöbetçi's own entries and still keeps a
dated backup. The tests in `hooks.rs` guard this; extend them when you touch it.

### 3. HIGH and CRITICAL always need a person

- A HIGH or CRITICAL approval needs a hold, and that is enforced in `pipe.rs` (`resolve`), not
  only in the UI. Never add an "always allow".
- Nothing HIGH or CRITICAL is approved automatically: rules, trusted projects and session grants
  are capped in `rules.rs`, and `auto_allow_max` can't go above `medium` (`settings.rs` sanitises
  it). Rules may always deny.
- Approvals from the island must be backed by a physical click (`inputguard.rs`, checked in
  `pipe::answer`); keep that check. The allow hotkey stays LOW-only.

### 4. No `innerHTML`

The approval card shows text an attacker may control, in a window that can approve commands. Build
the DOM with `h()` (`src/ui/dom.ts`) and text nodes only — no `innerHTML`, `outerHTML`,
`insertAdjacentHTML` or `document.write`, in the island or in Settings.

### 5. What the card shows is what runs

Never shorten an approval payload silently. When the relay has to cut something, it sets
`nobetci_truncated` and the request becomes HIGH. Invisible characters and long runs of
whitespace are made visible on the card; keep it that way.

### 6. Every decision is recorded, safely

Every permission request outcome is written to the history (`audit.rs`), including timeouts and
requests handed to the terminal. Text that outlives the card — the history and desktop
notifications — goes through `redact::redact`; the card itself always shows the request in full.
The CSV export must stay formula-safe.

### 7. One place knows Claude Code's format

The relay and the app speak a small JSON line
(`{"behavior":"deny","message":…,"interrupt":…,"stop":…}`). Only `hook/src/main.rs` knows Claude
Code's hook output format.

### 8. No telemetry, no network, no secrets

No HTTP clients, analytics, crash reporters or update checks, and nothing stored that would be
worth stealing.

### 9. Idle means idle

A hidden island uses no CPU to speak of: the frame loop stops, the cursor poll parks, and the
click guard only listens while a request is waiting. Don't add timers or polling that run while
the island is hidden.

### 10. Original assets only

The owl, the icons and the sounds are Nöbetçi's own. Sounds are synthesised in code
(`src/core/sound.ts`) and the icons are generated by `scripts/gen-icons.mjs`. Don't import
anything from Coucou's Mochi character, icons or sounds: they are not MIT-licensed.

### 11. Turkish and English, everywhere

Every user-visible string exists in both languages:

- **front end** — strings go through `defineMessages(tr, en)` from `src/i18n/core.ts`. The
  island keeps a Turkish and an English table in `src/i18n/island.ts`, and the type system
  rejects an English table that misses a Turkish key; the settings window keeps each string as a
  `[Turkish, English]` pair in `src/settings/i18n.ts`;
- **Rust** — use `i18n::pick(en, tr)` for anything the user or Claude will read: risk labels,
  rule notes, errors, the tray menu, denial messages.

If you don't speak Turkish, write the English and say so in the pull request; a maintainer will
help with the translation.

### 12. No invisible characters in the source

Nöbetçi flags zero-width and bidirectional control characters as an obfuscation trick, so its own
source must be free of them. If a test or a pattern needs one, write it as a Unicode escape
sequence, never as the raw character. `npm run check:invisible` (and CI) will tell you.

## Proposing a risk rule or reporting a false positive

The quickest way is the [risk rule issue template](https://github.com/tahap0l/nobetci/issues/new?template=risk_rule.yml):
the exact command, path or URL, the tool, the level you expected, the level Nöbetçi gave, and why.
You can check what it gives today in **Settings → Safety**, which has a tester.

To send a pull request instead:

1. Add the rule to the right table in `src-tauri/src/risk.rs`: `COMMAND_RULES`,
   `WRITE_PATH_RULES`, `CONTENT_RULES`, `READ_PATH_RULES` or `WEB_RULES`. Each rule has a stable
   category id, a level, a Turkish and an English label, a tag (`Secret` or `Exfil` if it is one
   half of a leak) and a regular expression. Patterns are matched case-insensitively by Rust's
   `regex` crate, which has no look-around or back-references.
2. Pick the lowest level that is honest:
   - **CRITICAL** — hard or impossible to undo, or a classic attack shape;
   - **HIGH** — deliberate, visible or persistent;
   - **MEDIUM** — worth a glance;
   - **LOW** — context, not alarm.

   Err on the side of noise only for what is hard to undo — deleting, publishing, persisting,
   leaking secrets — and stay quiet for everyday development.
3. Add tests in `risk.rs`: one showing the risky command gets the level, and a **"stays low"
   case** showing that everyday commands that look similar don't trip it (add them to
   `everyday_commands_stay_low` or write a new test).
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
- CI must be green: invisible characters, typecheck, rustfmt, clippy with warnings as errors,
  tests and the installer build.

By contributing, you agree that your contribution is licensed under the [MIT License](LICENSE),
like the rest of the project.

## Releasing (maintainers)

1. Bump the version in `package.json` (`npm version <x.y.z> --no-git-tag-version` updates
   `package-lock.json` too), in `[workspace.package]` in `Cargo.toml`, and in
   `src-tauri/tauri.conf.json`. Run `cargo check` so `Cargo.lock` follows.
2. Move the **Unreleased** entries in `CHANGELOG.md` into a new `## [x.y.z] - YYYY-MM-DD` section
   and update the comparison links at the bottom.
3. Commit, then tag and push: `git tag vx.y.z` and `git push origin vx.y.z`.

The [release workflow](.github/workflows/release.yml) checks that the tag matches all three
versions, builds and tests everything, packages the installer, writes `SHA256SUMS.txt`, and
publishes a GitHub release with that version's CHANGELOG section as its notes. A tag with a `-` in
it (for example `v0.3.0-beta.1`) becomes a pre-release.
