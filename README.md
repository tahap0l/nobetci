<div align="center">

<img src="src-tauri/icons/128x128@2x.png" width="96" height="96" alt="Nöbetçi's owl">

# Nöbetçi

**A watchful owl for your AI coding agents — starting with Claude Code.**

[![CI](https://github.com/tahap0l/nobetci/actions/workflows/ci.yml/badge.svg)](https://github.com/tahap0l/nobetci/actions/workflows/ci.yml)
![Windows 10 | 11](https://img.shields.io/badge/Windows-10%20%7C%2011-0078D4)
![macOS 11+ (beta)](https://img.shields.io/badge/macOS-11%2B%20(beta)-555555)
![Tauri 2](https://img.shields.io/badge/Tauri-2-24C8DB)
[![License: MIT](https://img.shields.io/badge/license-MIT-2EA043)](LICENSE)

**English** · [Türkçe](README.tr.md)

</div>

Nöbetçi is a small owl on a black island at the top of your screen. It watches your Claude Code
sessions, and when one of them asks for permission, it shows you exactly what would run, how risky
it looks and why — and lets you allow or deny it without hunting for the right terminal.

<p align="center">
  <img src="docs/media/en/critical.png" width="720" alt="Nöbetçi's approval card for a CRITICAL request: a command that pipes a downloaded script into bash and sends AWS credentials to a remote host, with the risky parts highlighted and four findings listed, a Deny button and a Hold · Allow button">
</p>

*Nöbetçi* (say "nuh-bet-CHEE") is Turkish for "the one on watch".

## Why

Claude Code asks before it runs a command, writes a file or calls a tool. It asks in the terminal:
the one you aren't looking at, or one of four running side by side. So prompts either sit there
unseen, or get approved on reflex — and in a terminal prompt, `npm test` and `curl … | bash` look
exactly the same.

Nöbetçi moves that decision to one place you can always see. It reads each request the way a
careful reviewer would, tells you what stands out and why, and makes the dangerous ones take a
deliberate press-and-hold instead of a click. When nothing needs you, it folds away into the top
edge of the screen.

## Features

### 👁 Watch

- **Every session on its own row.** Parallel Claude Code sessions — in Windows Terminal,
  Terminal.app, iTerm2, VS Code, Cursor or anywhere else — each get a row: what it's doing, for how long, and whether it's done,
  failed or waiting for you.
- **Session detail.** A timeline of recent steps, counters (tools, approvals, denials, automatic
  decisions) and **Go to window**, which brings the session's terminal or editor to the front.
- **Opens when it matters.** A permission request, an error or a question from Claude opens the
  island; a finished session can too, if you like. Otherwise it stays out of the way.
- **Desktop notifications** when the island is out of sight, synthesised sounds, and an owl whose
  mood follows the work.

### ✋ Decide

- **Risk-scored approval cards.** Every request is rated LOW, MEDIUM, HIGH or CRITICAL, with the
  reasons listed and the risky part of the command highlighted.
- **What you see is what runs.** The card shows the whole command, file path, URL or MCP arguments.
  Invisible and direction-changing Unicode characters appear as markers like `⟦U+202E⟧`, long runs
  of blank lines or spaces are collapsed into markers like `⟦40 blank lines⟧`, and a request too
  long to carry whole is flagged and scored HIGH — never silently cut.
- **Press and hold for the dangerous ones.** HIGH and CRITICAL requests need the Allow button held
  down (1.2 s and 2.4 s by default). The rule is enforced in Rust, not just in the UI.
- **Deny with a reason.** Pick a ready-made reason and Claude reads it, or **Deny and stop Claude**
  to end its turn. **Hand to terminal** gives the decision back to Claude Code's own prompt.
- **A queue, not a pile-up.** Requests that arrive together line up, up to six at a time; any
  beyond that go to the terminal, so none are lost.

### 🧭 Stay in control

- **Your rules.** Match on tool, pattern (contains, starts with, equals, glob or regex) and project
  folder, then allow, deny, always ask or re-score. Rules run in Rust, the first match wins, and a
  built-in tester shows the outcome before you save.
- **Project trust.** Mark folders as trusted (LOW requests pass on their own), normal, or strict
  (everything counts one level higher).
- **A hard ceiling on automation.** Rules, trusted projects and session grants can approve on their
  own only up to LOW (the default), up to MEDIUM, or not at all. **HIGH and CRITICAL are never
  approved without you.**
- **History and audit log.** Every permission request, its risk, the decision and who made it —
  you, a hotkey, a rule, a trusted project, a session grant, a timeout or the terminal. Search,
  filters, charts, CSV and JSON export.
- **Quiet when you need it.** Do not disturb, quiet hours, and (on Windows) automatic quiet while a
  full-screen app is in front. Requests still queue; nothing pops up or makes a sound.
- **And the rest.** Global hotkeys, a hook health check through the real relay, a choice of which
  hook events to listen to, per-category risk switches, island placement, settings import and
  export, and an English or Turkish UI that follows your system language.

### 🔒 Privacy

- **No network, no telemetry, no accounts.** Nöbetçi never connects anywhere — it doesn't even
  check for updates — and it stores no API keys or tokens.
- **Plain files on your machine.** Settings, history and log are JSON, JSON Lines and text.
- **Secrets stay out of the record.** API keys, tokens, passwords and private keys are masked
  before a request is written to the history or shown in a notification. The approval
  card itself always shows the request in full.

## How it works

```mermaid
flowchart LR
    CC["Claude Code<br/>(terminal or IDE)"]
    R["nobetci-hook<br/>small relay"]
    subgraph APP["Nöbetçi (tray / menu bar app)"]
        direction TB
        E["Risk engine + your rules<br/>(Rust)"]
        I["Island<br/>approval card"]
    end
    CC -- "hook event, JSON on stdin" --> R
    R -- "named pipe or Unix socket,<br/>your account only" --> E
    E -- "needs a person" --> I
    I -- "allow or deny" --> E
    E -- "decision" --> R
    R -- "decision JSON on stdout" --> CC
```

Claude Code runs the relay, `nobetci-hook`, for every hook event Nöbetçi is registered for. The
relay passes the event on over a channel that only your account can open — a named pipe on
Windows, a Unix socket in your Library folder on macOS — and exits. Only a
permission request waits for an answer: the risk engine scores it, your rules get the first word,
and a rule, a trusted project or a session grant can settle it on the spot. Everything else
becomes a card on the island, and your decision travels back the same way.

Nöbetçi is built so that it never holds Claude Code hostage:

| Situation | What happens |
| --- | --- |
| Nöbetçi isn't running | The relay finds nobody listening, exits at once with no output, and Claude Code asks in the terminal as usual. On Windows, a pipe that exists but is busy gets at most **300 ms**. |
| The island can't show the card | The app gives the island **800 ms** to confirm that the card is on screen or queued. No confirmation: back to the terminal. |
| Nobody answers | The app lets go after **108 s** and the relay after **110 s** (the hook itself is registered with a 120 s timeout). Claude Code then asks in the terminal. |
| Paused, or six requests already waiting | New requests go straight to the terminal. |
| Any other hook event | Fire and forget: connect, write, exit, within a hard 2 s budget. |

## Install

> 📖 The [installation guide](docs/install.md) goes through every step in detail, plus updating,
> uninstalling and troubleshooting.

Nöbetçi runs on **Windows 10 and 11** (64-bit) and on **macOS 11 or later** (Apple silicon and
Intel; macOS support is new and still a beta). It needs [Claude Code](https://code.claude.com/docs/en/overview)
running on the same system — Claude Code inside WSL or a container keeps its settings elsewhere
and isn't covered.

### Windows

The Microsoft Edge WebView2 runtime is part of Windows 11 and current Windows 10; the installer
fetches it if it's missing.

1. Download `Nobetci-x.y.z-setup.exe` and `SHA256SUMS.txt` from the
   [latest release](https://github.com/tahap0l/nobetci/releases/latest).
2. Check that the installer is the one that was published:

   ```powershell
   Get-FileHash .\Nobetci-0.2.0-setup.exe -Algorithm SHA256
   Get-Content .\SHA256SUMS.txt
   ```

   The two hashes must be identical (upper or lower case doesn't matter).
3. Run the installer. It installs for your Windows account only, into `%LOCALAPPDATA%\Nobetci`,
   and needs no administrator rights. Add `/S` for a silent install.

> [!NOTE]
> **"Windows protected your PC"?** Releases aren't code-signed yet, so a new installer has no
> SmartScreen reputation. Once you've checked the hash, choose **More info → Run anyway**. Signed
> releases are on the [roadmap](#roadmap).

### macOS (beta)

1. Download `Nobetci-x.y.z-macos-universal.dmg` and `SHA256SUMS.txt` from the
   [latest release](https://github.com/tahap0l/nobetci/releases/latest).
2. Check the disk image in Terminal:

   ```sh
   shasum -a 256 ~/Downloads/Nobetci-0.2.0-macos-universal.dmg
   cat ~/Downloads/SHA256SUMS.txt
   ```

3. Open the disk image and drag **Nobetci** into **Applications**.
4. Open it from Applications. The app isn't notarized by Apple yet, so the first time macOS
   refuses: choose **Done**, then go to **System Settings → Privacy & Security**, scroll to
   *"Nobetci" was blocked…* and click **Open Anyway**. (On macOS 14 and earlier, Control-click the
   app → **Open** → **Open** works too.)

Nöbetçi lives in the menu bar, with no Dock icon. The [installation guide](docs/install.md#macos)
has the details.

### Build from source

You need [Rust](https://rustup.rs) with the MSVC toolchain, Node.js 20 or newer, and the
[Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with the
"Desktop development with C++" workload.

```powershell
git clone https://github.com/tahap0l/nobetci.git
cd nobetci
npm ci
npm test         # builds the relay, then the Rust tests: risk engine, rules, relay, history…
npm run pack     # → release\Nobetci-<version>-setup.exe
```

On a Mac you need the Xcode Command Line Tools (`xcode-select --install`), Rust with both Apple
targets (`rustup target add aarch64-apple-darwin x86_64-apple-darwin`) and Node.js 20 or newer;
`npm run pack:mac` builds `release/Nobetci-<version>-macos-universal.dmg`.

## First run

Start Nöbetçi from the Start menu (on a Mac, from Applications). The owl says hello at the top of
the screen — on a Mac just below the menu bar — then the island folds away and Nöbetçi keeps watch
from the notification area (the menu bar on a Mac). On the very first launch a short
welcome wizard opens as well: pick a language, connect Claude Code, run a health check, set the
safety basics, done. You can skip it — everything in it is also in Settings.

Nöbetçi can only see Claude Code once its hooks are in `~/.claude/settings.json`. The wizard's
**Connect** step — or **Settings → Claude Code → Install hooks…** at any time — adds them the
careful way:

- you see the exact change as a diff before anything is written;
- a dated backup is saved next to the file first (`settings.json.bak-YYYYMMDD-HHMMSS`);
- your other settings and every other tool's hooks stay exactly as they were;
- nothing is written until you click, and if the file changes between the preview and your click,
  Nöbetçi refuses and shows you a fresh diff.

<p align="center">
  <img src="docs/media/en/wizard.png" width="720" alt="The welcome wizard that opens on first launch">
</p>

Then press **Health check** in **Settings → Claude Code**: it runs the relay exactly the way
Claude Code would and times a ping through it. Claude Code reads hooks when a session
starts, so restart any session that was already running.

## Using it

### The island

<p align="center">
  <img src="docs/media/en/overview.png" width="49%" alt="The expanded island listing three Claude Code sessions with their state and last step">
  <img src="docs/media/en/session.png" width="49%" alt="Session detail: a timeline of recent steps, counters and a Go to window button">
</p>

- **Hidden** — a thin, invisible strip along the top edge. Move the mouse there to wake it.
- **Compact** — a small black pill with one line of status ("2/3 working", "Needs approval —
  click") and a mini owl for each session. Click it to open.
- **Expanded** — your sessions, a session's detail, or the approval card. It folds back 15 s after
  the mouse leaves (adjustable), but never while a request is waiting.

The tray icon (the menu bar icon on a Mac) has **Open Nöbetçi**, **Settings…**, **Pause / resume**, **Do not disturb on / off**
and **Quit**.
Pausing hands every waiting request back to the terminal. A hidden island costs next to nothing:
the animation loop stops and the cursor poll parks.

### The approval card

<p align="center">
  <img src="docs/media/en/low.png" width="720" alt="An approval card for a LOW-risk npm test command with an Allow button and the option not to ask again in this session">
</p>

- **The header** shows the risk level, the session and tool, your place in the queue and a
  countdown to when the terminal takes over.
- **The request** is shown in full — the command, the file path (with the start of what would be
  written), the URL or the MCP arguments — with the parts behind each finding highlighted. If the
  box has to scroll, it says "there's more — scroll".
- **The findings** list every reason with its level, plus any rule or project note ("Strict
  project", or a rule that wanted to allow the request but hit the ceiling).
- **Allow** is a click for LOW and MEDIUM. For HIGH and CRITICAL it reads **Hold · Allow**: keep
  it pressed until the bar fills.
- **Deny** refuses the request. The arrow next to it opens ready-made reasons that are passed on to
  Claude (edit them in Settings → Rules) and **Deny and stop Claude**, which ends the turn.
- **Don't ask again for this request in this session** is offered only where the auto-allow ceiling
  allows it: LOW with the default ceiling, LOW and MEDIUM with *LOW + MEDIUM*, never with the
  ceiling off. It covers the exact same tool and target, in that session, until Nöbetçi restarts.
- **Hand to terminal** lets Claude Code ask in the terminal instead.

### Risk levels

| Level | What it means | Examples |
| --- | --- | --- |
| **LOW** | Nothing obvious — which is *not* the same as safe. | `npm test`, `git status`, `cargo build --release`, editing `src/main.ts`, `rm old.log` |
| **MEDIUM** | Worth a glance. | `git push origin feature`, `npm i -D left-pad`, `pip install requests`, `gh pr create`, writing outside the project folder, editing `.github/workflows/ci.yml`, `mcp__gmail__send_email` |
| **HIGH** | Deliberate, visible or hard to undo. Press and hold to allow. | `rm -rf node_modules`, `git push --force`, `git reset --hard`, `npm publish`, `schtasks /create …`, `certutil -urlcache …`, reading `~/.ssh/id_rsa` or `.env`, writing `.git/hooks/pre-commit` or `.mcp.json`, invisible Unicode characters |
| **CRITICAL** | Irreversible, or a classic attack shape. A longer hold. | `curl … \| bash`, `irm … \| iex`, `powershell -enc …`, `Set-MpPreference -DisableRealtimeMonitoring $true`, `vssadmin delete shadows`, `rm -rf ~`, `gh repo delete`, writing `~/.claude/settings.json`, reading a secret and sending it out in the same request |

The Turkish UI calls the levels DÜŞÜK, ORTA, YÜKSEK and KRİTİK.

<details>
<summary><b>What the risk engine looks for</b></summary>

**Commands** (Bash and PowerShell)

- **CRITICAL** — running code straight from the internet (`curl … | sh`, `iex (irm …)`);
  encoded or base64-obfuscated commands; switching off Defender or the firewall, deleting shadow
  copies or event logs, `bcdedit`; on macOS, switching off Gatekeeper (`spctl --master-disable`),
  SIP, the application firewall or quarantine, resetting privacy permissions (`tccutil reset`) or
  erasing the unified log; formatting or overwriting a disk (including `diskutil erase…`); deleting the home folder, a
  drive or the root; deleting a GitHub repository or making it public; changing Claude Code's
  permission or hook settings; changing Nöbetçi's own settings or swapping its relay; touching SSH
  `authorized_keys`.
- **HIGH** — trying to stop Nöbetçi; recursive deletes; force pushes and other irreversible git operations; publishing
  packages or releases; `sudo`, `runas`, `gsudo` and AppleScript's `with administrator privileges`;
  persistence (scheduled tasks, Run keys, services, startup folders, cron, systemd, LaunchAgents
  and LaunchDaemons, login items); removing the macOS quarantine flag (`xattr -d`);
  reading the macOS keychain (`security find-generic-password`, `dump-keychain`); suspicious
  built-in Windows tools such as `mshta`,
  `regsvr32 /i:`, `certutil -urlcache` or `bitsadmin /transfer`; bypassing the PowerShell
  execution policy; credential and secret files; known exfiltration services (paste sites,
  request catchers, tunnels, chat webhooks); overly broad permissions (`chmod 777`,
  `icacls … Everyone:F`, `takeown`); shutdown and reboot; destructive database commands;
  privileged or host-mounting Docker runs and Docker prunes; cloud deletions
  (`terraform destroy`, `kubectl delete`, `aws … delete-…` and friends); deletes through the
  GitHub API; invisible or direction-changing characters; content pushed out of view by long runs
  of blank lines or spaces.
- **MEDIUM** — sending data out (`curl -d`, `nc`, `scp`, `rsync` to a remote, FTP,
  `Send-MailMessage`); dumping environment variables; registry changes and `setx`; killing
  processes; installing packages or running them straight from a registry (`npm i`, `npx -y`,
  `pip install`, `winget install`, `brew install` …); dynamic code (`iex`, `eval`, `python -c`,
  `node -e`, `osascript -e`);
  `git push`; public GitHub actions such as opening PRs or issues, commenting or creating gists;
  touching Claude Code's settings; very long commands.
- **LOW**, for context — network access, deleting or moving single files, rewriting git history.

**File writes** — CRITICAL for Claude Code's settings files, Nöbetçi's own files and anything under
`~/.ssh`; HIGH for
Claude Code hooks, agents, commands, skills and plugins, `.mcp.json`, git hooks and git config,
shell profiles, startup folders and LaunchAgents, system files, secrets files (the macOS keychain
included), and content that contains a
private key or invisible characters; MEDIUM for CI workflows, `CLAUDE.md`, install scripts
(`postinstall`), secrets that look hard-coded, and anything outside the project folder; LOW for
build files such as `package.json`, `Cargo.toml` or a `Dockerfile`. Templates such as
`.env.example` don't trigger the path rules.

**File reads** — HIGH for secrets (SSH keys, `.env`, credential files, cloud and Kubernetes
configs, browser cookies and saved logins).

**Web** — HIGH for known exfiltration services, MEDIUM for bare IP addresses and very long query
strings, LOW for plain `http://`.

**MCP tools** — HIGH when the tool name says delete, remove, trash, destroy, drop, purge or
revoke; MEDIUM when it sends, posts, publishes, creates, updates, uploads, pays, deploys or runs
something; LOW otherwise.

**Combinations** — a secret and a way out in the same request is CRITICAL, and a request that had
to be cut to fit is HIGH. These two can't be switched off; every other category can, in
**Settings → Safety → Risk categories**. The same page has a tester that scores any command, path
or URL you type.

</details>

### Rules, project trust and the ceiling

<p align="center">
  <img src="docs/media/en/settings-rules.png" width="720" alt="The Rules page in Settings: a list of rules with their tool, pattern and action, and project trust settings">
</p>

Rules are checked from top to bottom before a card is shown, and the first match wins.

| A rule can… | How it behaves |
| --- | --- |
| **Allow** | Only up to the auto-allow ceiling. A riskier match still comes to you, with a note saying which rule wanted to allow it. |
| **Deny** | At any level. The request never reaches you, and Claude gets your message. |
| **Always ask** | Even where a trusted project or a session grant would have let it through. |
| **Re-score** | Set the level from LOW to CRITICAL — useful for a false alarm. A CRITICAL finding never drops below HIGH, so it still needs a hold. |

The templates are a good start: allow `npm test` and read-only git commands, forbid
`git push --force` and package publishing, keep Claude away from `.env` files, make `rm -rf`
always CRITICAL, and ask every time for MCP tools.

**Project trust** (Settings → Rules) — *trusted*: LOW requests go through on their own, within the
ceiling; *normal*: the default; *strict*: every request counts one level higher (MEDIUM becomes
HIGH, HIGH becomes CRITICAL). When folders are nested, the most specific one wins.

**Auto-allow ceiling** (Settings → Safety) — *Off*, *LOW only* (the default) or *LOW + MEDIUM*.
It caps what rules, trusted projects and session grants may approve without you. HIGH and CRITICAL are never
approved automatically: the cap lives in Rust, and a hand-edited settings file can't lift it.

### History

<p align="center">
  <img src="docs/media/en/settings-history.png" width="720" alt="The History page in Settings: charts of daily decisions and risk levels above a searchable list of requests">
</p>

Every permission request is recorded: when, the project and tool, the target (up to 4,000
characters, secrets masked), the risk and findings, the decision, who made it and how long it
took. Search it, filter it, look at daily charts and the most frequent projects, findings and
tools, and export everything that matches as CSV or JSON. The CSV is safe to open in a
spreadsheet: cells that would be read as formulas are defused.

The history lives in `audit.jsonl` in Nöbetçi's data folder (see [Development](#development)),
rolls over to `audit.1.jsonl` at 10 MB
(adjustable), and can be switched off or cleared in **Settings → History**.

### Hotkeys

| Action | Default |
| --- | --- |
| Open or fold the island | `Ctrl+Alt+N` |
| Deny the request on the card | `Ctrl+Alt+D` |
| Allow the request on the card | Not set — LOW-risk requests only |
| Do not disturb on / off | Not set |

On a Mac, Ctrl is ⌃ Control and Alt is ⌥ Option. Hotkeys work from any window. Any program can
fake keystrokes, so the allow hotkey is off by
default and — enforced in Rust — never approves anything above LOW. Change them in
**Settings → Notifications**.

### Quiet

**Do not disturb** (the moon button on the island, the tray menu or a hotkey), **quiet hours**
(for example 23:00–08:00) and **quiet in full screen** (Windows only for now; on by default, for
games, presentations and full-screen video). While it's quiet there are no sounds and no notifications, and the island
doesn't pop open — but requests still queue, and the compact island tells you one is waiting.

## Security model

Nöbetçi is a second pair of eyes, not a sandbox. The risk engine is a set of heuristics: it
catches the obvious and the classic, a determined attacker can get past it, and LOW means
"nothing obvious", never "safe". What it adds is visibility, friction for dangerous actions, and
reasons you can read.

<p align="center">
  <img src="docs/media/en/settings-security.png" width="720" alt="The Safety page in Settings: the auto-allow ceiling, hold times, the physical click guard and the list of risk categories">
</p>

What it takes care of: the card shows exactly what will run; HIGH and CRITICAL approvals need a
hold that Rust enforces; approvals must come from a physical mouse click on the Allow button
itself — one click, one approval — so a script can't press Allow on the agent's behalf; the relay
and the app talk over a named pipe (Windows) or a Unix socket (macOS) that only your account can
open, and the relay checks that the app on the other end runs as you; the history masks
secrets, and its CSV export is formula-safe.

What it can't do: stop malware that already runs as you, see approvals you give in the terminal,
or tell every fake input from a real one. Read [SECURITY.md](SECURITY.md) for the full threat
model and for how to report a vulnerability.

## FAQ

**Does it slow Claude Code down, or block it?**
No. The relay is a small native program: it connects, hands the event over and exits, with a hard
2-second budget — and far less in practice (**Health check** shows the round trip on your
machine). If Nöbetçi isn't running, the relay exits immediately. Only permission requests wait,
and only while a card is really on your screen, for at most 110 seconds before the terminal takes
over.

**Does it send anything anywhere?**
No. Nöbetçi makes no network connections: no telemetry, no crash reports, no update checks, no
accounts. Everything stays in plain files on your machine.

**What happens if Nöbetçi is closed, paused or crashes?**
Claude Code carries on as if Nöbetçi weren't installed: with nobody listening (or the island
paused), the relay exits without output and Claude Code asks in the terminal.

**What happens when I uninstall it?**
On Windows the uninstaller runs `nobetci.exe --remove-hooks`, which removes Nöbetçi's own entries
from `~/.claude/settings.json` — with a dated backup next to it — and touches nothing else. A Mac
has no uninstallers, so remove the hooks in Settings first. See [Uninstall](#uninstall).

**Does it run on macOS? Linux?**
macOS 11 or later, yes — new in 0.2.0 and still a beta, so please report anything odd. A few
things differ there: the island sits below the menu bar, clicking it makes Nöbetçi the active
app, **Go to window** brings the session's app to the front rather than one particular window,
and quiet in full screen isn't available yet.
Linux is on the [roadmap](#roadmap).

**Why does macOS refuse to open it?**
Releases aren't notarized by Apple yet. Check the SHA-256, then open it once through **System
Settings → Privacy & Security → Open Anyway**. The [installation guide](docs/install.md#macos)
walks through it.

**Why do SmartScreen or Defender warn about it?**
The installer isn't code-signed yet, so SmartScreen has no reputation for it. Check the SHA-256
against the release, then choose **More info → Run anyway**. If Microsoft Defender flags a
release, please [open an issue](https://github.com/tahap0l/nobetci/issues) — reporting the file to
Microsoft as a false positive helps too.

**Does it work with VS Code, Cursor, Windows Terminal, Terminal.app or iTerm2?**
Yes. Nöbetçi hooks into Claude Code itself, so it doesn't matter where a session runs. **Go to
window** follows the session's process chain to the window (on a Mac, the app) it lives in, and
opens the project folder if it can't find one.

**Could Claude approve its own requests through Nöbetçi?**
Not through the island: approvals must come from a physical click, the allow hotkey is off by
default and LOW-only, and HIGH and CRITICAL need a hold. But whatever an approved command starts
runs with your rights and could, for instance, edit Claude Code's settings directly — which is
exactly why such requests are scored CRITICAL. The [threat model](SECURITY.md) has the details.

## Uninstall

### Windows

Open **Settings → Apps → Installed apps** (**Apps & features** on Windows 10), find **Nobetci**
and choose **Uninstall**. The uninstaller:

1. removes Nöbetçi's entries from `~/.claude/settings.json`, after saving a dated
   `settings.json.bak-YYYYMMDD-HHMMSS` next to it — nothing else in the file changes;
2. removes the app, the relay (`%LOCALAPPDATA%\Nobetci\bin`) and the log.

Your preferences (`%APPDATA%\Nobetci`) and history (`%LOCALAPPDATA%\Nobetci\audit.jsonl`) stay, so
a reinstall picks up where you left off. Delete those two folders to remove every trace. If you'd
rather take the hooks out yourself first, **Settings → Claude Code → Remove…** shows the diff
like any other change.

### macOS

1. **Settings → Claude Code → Remove…** takes Nöbetçi's entries out of `~/.claude/settings.json`
   (with a diff and a dated backup, as always).
2. If **Start at login** is on, switch it off in **Settings → General**.
3. Quit Nöbetçi from the menu bar and move **Nobetci** from Applications to the Bin.

Your preferences, history and the relay stay in `~/Library/Application Support/Nobetci`; delete
that folder to remove every trace. Forgot step 1? Nothing breaks: the relay is still in that
folder, finds nobody listening and exits, and Claude Code carries on — or run
`/Applications/Nobetci.app/Contents/MacOS/nobetci --remove-hooks` before you delete the app.

## Development

```powershell
npm run dev          # the UI alone, in a browser, with demo data (no Rust needed)
npm run tauri dev    # the real app, with live reload
npm test             # Rust tests
npm run lint         # clippy (warnings are errors) and the TypeScript typecheck
npm run pack         # the Windows installer, into release\
npm run pack:mac     # the macOS disk image (universal), into release/
```

With `npm run dev` running:

- `http://127.0.0.1:1420/?demo=critical` shows the island with fake sessions and requests. Other
  demos: `low`, `write`, `hidden`, `deny-menu`, `overview`, `session`, `compact`, `empty`.
- `http://127.0.0.1:1420/settings.html?tab=kurallar` opens Settings with mock data. Tabs:
  `genel`, `claude`, `guvenlik`, `kurallar`, `bildirimler`, `gecmis`, `hakkinda`, plus
  `hosgeldin` for the welcome wizard.
- Add `&lang=en` or `&lang=tr` to pick the language, and `&platform=macos` to see the Mac wording.
- In the browser console, `nobetci.inject({ … })` feeds the island a fake hook event.

```text
hook/                  nobetci-hook — the relay Claude Code runs on every hook event
  src/win.rs · mac.rs  named pipe (Windows) / Unix socket (macOS), parent-process chain
src-tauri/src/
  risk.rs              risk engine and categories (+ tests)
  rules.rs             user rules, project trust, session grants (+ tests)
  pipe.rs              relay server and approval decisions
  pipe/                named_pipe.rs (Windows) · unix_socket.rs (macOS)
  audit.rs             history, statistics, CSV/JSON export (+ tests)
  redact.rs            secret masking for the history and notifications
  inputguard.rs        physical-click guard
  inputguard/          raw_input.rs (Windows Raw Input) · appkit.rs (macOS event source)
  hooks.rs             ~/.claude/settings.json install and removal (diff + backup)
  settings.rs          preferences and their limits
  island.rs            the transparent, click-through island window
  sys.rs               small per-OS helpers: clock, language, full screen, home folder
  quiet.rs · focus.rs · hotkeys.rs · tray.rs · i18n.rs
src/
  baykus/              the owl, its greeting and mini heads (Canvas 2D)
  island/              state machine, hook events, geometry
  ui/                  island views, including the approval card
  core/                state, bridge to Rust, synthesised sounds
  settings/            the settings window
  i18n/                Turkish and English strings
scripts/               installer packaging, icon generator, screenshots, checks
```

| What | Windows | macOS |
| --- | --- | --- |
| Preferences | `%APPDATA%\Nobetci\settings.json` | `~/Library/Application Support/Nobetci/settings.json` |
| History | `%LOCALAPPDATA%\Nobetci\audit.jsonl` (+ `audit.1.jsonl`) | `~/Library/Application Support/Nobetci/audit.jsonl` |
| Log | `%LOCALAPPDATA%\Nobetci\nobetci.log` | `~/Library/Application Support/Nobetci/nobetci.log` |
| Relay | `%LOCALAPPDATA%\Nobetci\bin\nobetci-hook.exe` | `~/Library/Application Support/Nobetci/bin/nobetci-hook` |
| Claude Code hooks | `%USERPROFILE%\.claude\settings.json` | `~/.claude/settings.json` |

Backups of the Claude Code settings sit next to them as `settings.json.bak-*`.

Contributions are welcome — [CONTRIBUTING.md](CONTRIBUTING.md) has the setup, the ground rules and
how to report a false positive.

## Roadmap

Ideas, not promises:

- **Signed releases**, for example through [SignPath Foundation](https://signpath.org/)'s free code
  signing for open-source projects.
- **Notarized macOS builds**, so Gatekeeper opens them without a detour.
- **Other agents** — Cursor and other coding agents that offer hooks or a permission API.
- **Linux**, plus full-screen quiet and an island that never takes focus on macOS.
- **Sharper rules** — more coverage and fewer false positives. Reports are very welcome.

## Credits

Nöbetçi began as a fork of [Coucou](https://github.com/Louis-CFM/coucou) by Louis Raillé (MIT). The
named-pipe relay, the pipe server, the reviewed-diff hook installer, the transparent island window
and its open/close state machine were carried over and adapted. The owl, the icons, the
synthesised sounds, the risk engine and everything built on it are original to Nöbetçi; Coucou's
name, character, icons and sounds are not used. [NOTICE.md](NOTICE.md) has the details.

## License

[MIT](LICENSE). See [NOTICE.md](NOTICE.md) for the parts adapted from Coucou.
