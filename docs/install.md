# Installing Nobi

**English** · [Türkçe](kurulum.md)

This guide walks through every step, from downloading Nobi to connecting it to Claude Code,
updating and uninstalling. A troubleshooting section is at the end.

> **On a Mac or on Linux?** Sections 1–3 and 8–10 describe Windows. Read [macOS](#macos) or
> [Linux](#linux) for those steps — the rest is the same everywhere.

## Contents

1. [Requirements](#1-requirements)
2. [Download and verify](#2-download-and-verify)
3. [Install](#3-install)
4. [First run and the setup wizard](#4-first-run-and-the-setup-wizard)
5. [Connect Claude Code](#5-connect-claude-code) (and Codex, ChatGPT Work and Cursor)
6. [Try it](#6-try-it)
7. [Suggested first settings](#7-suggested-first-settings)
8. [Update](#8-update)
9. [Uninstall](#9-uninstall)
10. [Where things live](#10-where-things-live)
11. [Troubleshooting](#11-troubleshooting)
12. [Build from source](#12-build-from-source)
13. [macOS](#macos)
14. [Linux](#linux)

## 1. Requirements

| | |
| --- | --- |
| Operating system | Windows 10 or 11, 64-bit — or macOS 11 or later, see [macOS](#macos) — or Linux, see [Linux](#linux) |
| Claude Code | Claude Code running on Windows itself (terminal, VS Code, Cursor, the Claude desktop app…). Claude Code inside WSL keeps its settings elsewhere and isn't covered. Codex, ChatGPT Work and Cursor are optional. |
| WebView2 | Part of Windows 11 and current Windows 10; the installer fetches it if it's missing. |
| Rights | **No** administrator rights needed; Nobi installs for your account only. |

## 2. Download and verify

1. From the [latest release](https://github.com/tahap0l/nobi/releases/latest), download:
   - `Nobi-x.y.z-setup.exe` — the installer (`x.y.z` is the version; releases after 2.4.1
     also carry the same file as `Nobi-setup.exe`)
   - `SHA256SUMS.txt` — the fingerprints of every file in the release
2. Check that your download is the published file. Open PowerShell in the download folder and run:

   ```powershell
   Get-FileHash .\Nobi*setup.exe -Algorithm SHA256
   Get-Content .\SHA256SUMS.txt
   ```

   The long value must be **identical** to the one listed for that file (case doesn't matter). If
   it differs, don't run the file — download it again.

Releases aren't code-signed yet (see the [code signing policy](../CODE_SIGNING_POLICY.md)), so this
check is what tells you the file is the one that was published.

## 3. Install

1. Double-click `Nobi-x.y.z-setup.exe`.
2. **"Windows protected your PC"?** Releases aren't code-signed yet, so SmartScreen doesn't know the
   file. Once you've checked the fingerprint, choose **More info → Run anyway**.
3. Installation takes a few seconds and goes into `%LOCALAPPDATA%\Nobi`. It shows up in the Start
   menu as **Nobi**. The installer speaks Turkish on a Turkish Windows and English everywhere
   else.

> Silent install: `.\Nobi-x.y.z-setup.exe /S` (with your version in place of `x.y.z`).

## 4. First run and the setup wizard

Start Nobi from the Start menu. An owl appears at the top centre of the screen and says hello,
then the island folds away and Nobi keeps watch from the notification area next to the clock.

On the first launch a five-step **setup wizard** opens:

| Step | What you do |
| --- | --- |
| 1. Welcome | Pick the language: Automatic (follows Windows), Türkçe or English. |
| 2. Connect | Install the Claude Code hooks (details below). |
| 3. Health check | See the connection work end to end. |
| 4. Safety | Set the auto-allow ceiling, the hold times and the physical click guard. |
| 5. Done | A few tips. |

Every step has **Skip for now**; everything in it is also in **Settings**. To open the wizard again:
**Settings → About → Run the setup wizard again**.

## 5. Connect Claude Code

Nobi sees Claude Code through **hooks**, added to `~/.claude/settings.json`
(`C:\Users\<you>\.claude\settings.json`) — or to `settings.json` in the folder `CLAUDE_CONFIG_DIR`
names, if you keep Claude Code's settings there. Nobi follows that variable only when it holds
an absolute path and Nobi itself sees it: an app started from the Start menu doesn't see a
variable set only in a terminal's profile, so set it for your Windows account (**Edit environment
variables for your account**). **Settings → Claude Code** shows the file Nobi uses.

1. Start from the wizard's **Connect** step, or **Settings → Claude Code → Install hooks…**.
2. Nobi shows the change to the file as a **diff**: added lines in green. Your other settings and
   other tools' hooks stay as they are. The diff is worked out on the file's own text, so if the
   write would reformat anything else, you see that too. While the preview is open, nothing else on
   the page can change what will be written.
3. Look it over and click **Approve and write**. A dated backup is saved next to the file first
   (`settings.json.bak-YYYYMMDD-HHMMSS`; none when there is no file yet). Exactly the previewed
   change is written; if the file changed after the preview, Nobi refuses and offers a fresh
   preview.
4. Press **Settings → Claude Code → Health check**. Every line should be ✓:
   - the hooks are in `settings.json`, `PermissionRequest` and `PreToolUse` among them,
   - the relay (`nobi-hook.exe`) is in place,
   - a ping gets through the pipe (a few milliseconds),
   - the physical click guard is ready.
5. **Restart any Claude Code session that was already open.** Claude Code reads hooks when a
   session starts.

`PreToolUse` matters more than it looks: it carries the questions and plans the island answers, and
in the Claude desktop app — which never runs `PermissionRequest` — every approval. Leave it on.

### Codex, ChatGPT Work and Cursor (optional)

- **Codex and ChatGPT Work:** **Settings → ChatGPT → Connect…** writes Nobi's hooks into Codex's
  `hooks.json` (in `$CODEX_HOME`, or `~/.codex`) after the same kind of reviewed diff. Then review
  and trust the hooks in the ChatGPT desktop app under **Settings → Hooks** (if the list is empty,
  add a local project in the Codex view and refresh it), or with `/hooks` in the Codex CLI. Send a
  message in a new local chat and run **Health check** to see it arrive. Work Cloud doesn't run
  local hooks.
- **Cursor:** **Settings → Other agents → Connect…** writes `~/.cursor/hooks.json`. When Nobi
  gives no answer for a Cursor shell or MCP request — it is closed or paused, you handed the
  request back, or it timed out — Cursor asks you itself. Nobi registers its Cursor permission
  hooks *fail-closed*, though: if the relay itself can't run, Cursor blocks the command. Remove the
  connection before you remove Nobi (see [Uninstall](#9-uninstall)).

## 6. Try it

1. Start a new Claude Code session. The island briefly says the session started; move the mouse to
   the top centre of the screen to see it as a row.
2. Ask Claude for something that needs permission, such as running a command you haven't allowed
   before.
3. The island opens with an **approval card**: the whole command, its risk level and the reasons.
4. Click **Allow** as usual. For HIGH and CRITICAL requests, keep the button pressed until the bar
   fills (on Linux those are approved in the terminal instead: see [Linux](#linux)). A card that
   has only just appeared ignores clicks for a moment, so a stray double-click can't approve it.

You can also type a command into **Settings → Safety → Try the risk engine** to see how it's scored,
without running anything.

For a message to any AI agent, open **Settings → Prompt Studio**, choose the target and review a
draft. Local Ollama is the default; Ollama models marked **cloud** may forward the draft. To use
OpenAI, select it and add your key; Nobi stores the key in the operating system credential vault.
The rewritten message is shown for review and copied only when you ask. Paste it into the target app
yourself; Nobi does not read or send messages in other apps automatically.

## 7. Suggested first settings

| Setting | Where | Suggestion |
| --- | --- | --- |
| Start with Windows | Settings → General | On — while Nobi is closed, questions fall back to the terminal. |
| Auto-allow ceiling | Settings → Safety | **LOW only** (the default). HIGH and CRITICAL are never approved automatically anyway. |
| Physical click guard | Settings → Safety | On (the default). Using a touchscreen, a laptop touchpad or an accessibility tool? See [troubleshooting](#approval-refused-not-a-physical-click). |
| Rules | Settings → Rules | Start from the templates: allow `npm test`, block force push, keep it out of `.env` files. |
| Shortcuts | Settings → Notifications | Ctrl+Alt+N opens the island, Ctrl+Alt+D denies the request on the card. |
| Do not disturb | The button in the island's header, or the tray menu | During a presentation or a game. Full screen goes quiet by itself. |

**Settings → About** exports your settings to a file and imports them again, on this computer or
another. An import takes only Nobi's own settings (an exported file carries
`"nobiSettings": 1`) and refuses any other JSON, Claude Code's `settings.json` included. An
import and **Reset to defaults** both keep the settings they replace as `settings.json.bak-<date>`
next to the file; a reset leaves your hooks alone and doesn't bring the setup wizard back.

## 8. Update

Download the new installer (check its fingerprint) and run it. Nobi closes during the update;
start it again when the installer is done.

Installing another version over the current one is an update, not an uninstall: your settings,
agenda and history, your Claude Code, Codex and Cursor hooks and **Start with Windows** are all
kept, whichever version you update from. That holds for going back to an older version too, as
long as the installer you run is newer than 2.4.1. Only choosing to uninstall, on the page the
installer shows when you run the version you already have, removes them.

The installers of 2.4.1 and earlier don't know this. To go back to one of them and keep
everything, choose **Do not uninstall** on the page it shows. Its preselected choice, **Uninstall
before installing**, removes the hooks and **Start with Windows** (your settings, agenda and history
stay unless you tick **Delete the application data**): install the hooks again afterwards in
**Settings → Claude Code**, **ChatGPT** and **Other agents**, and switch **Start with Windows** back
on.

If a new version changes what the hooks need, **Settings → Claude Code** (or **ChatGPT**, **Other
agents**) says the connection is out of date; review the diff and update it there.

## 9. Uninstall

Open **Settings → Apps → Installed apps** (**Apps & features** on Windows 10), find **Nobi** and
choose **Uninstall**. The uninstaller:

1. asks you to close Nobi if it is running — **Cancel** there changes nothing at all;
2. runs `nobi.exe --remove-hooks`, which removes **only Nobi's own** entries from
   `~/.claude/settings.json`, from Codex's `hooks.json` and from `~/.cursor/hooks.json`, after
   saving a dated backup next to each one (`settings.json.bak-…`, `hooks.json.bak-…`). Nothing
   else in those files changes. This is the one write to them without a diff on screen;
3. removes the app, the relay, the log, the **Start with Windows** entries and, if you set up the
   [ChatGPT Web bridge](../integrations/chatgpt-web/README.md), its registration with Chrome and
   Edge.

If the hooks can't be removed (a read-only or locked file, for example), the uninstaller keeps the
relay and the log, so Claude Code, Codex and Cursor go on working, and shows which entries to delete
by hand; the log says what went wrong. `nobi.exe --remove-hooks` opens no console window, so
nothing it prints shows up: each file it cleans, or fails to clean, is noted in
`%LOCALAPPDATA%\Nobi\nobi.log`, and the uninstaller reads its exit status — 1 when a file
couldn't be cleaned, 0 when no entry of Nobi's is left. To see that status when you run it
yourself, start it from PowerShell like this:

```powershell
(Start-Process "$env:LOCALAPPDATA\Nobi\nobi.exe" -ArgumentList '--remove-hooks' -Wait -PassThru).ExitCode
```

Your preferences and agenda (`%APPDATA%\Nobi`) and history (`%LOCALAPPDATA%\Nobi\audit.jsonl`)
stay, so a reinstall picks up where you left off. Tick **Delete the application data** in the
uninstaller to remove `%APPDATA%\Nobi`, `%LOCALAPPDATA%\Nobi` and the WebView's own folders
too.

To review each change instead, remove the connections first in **Settings → Claude Code →
Remove…**, **Settings → ChatGPT → Remove connection…** and **Settings → Other agents → Remove
connection…**.

If you set up the ChatGPT Web bridge, remove its extension in `chrome://extensions` or
`edge://extensions` too. The uninstallers of 2.4.1 and earlier leave the bridge's registration
behind: before uninstalling one of those, run the unregister script in PowerShell, from the
`integrations\chatgpt-web` folder. It removes the registration for Chrome and Edge and deletes its
manifests:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\unregister-windows.ps1
```

## 10. Where things live

| What | Where |
| --- | --- |
| App | `%LOCALAPPDATA%\Nobi\` |
| Relay | `%LOCALAPPDATA%\Nobi\bin\nobi-hook.exe` |
| Preferences | `%APPDATA%\Nobi\settings.json` |
| Agenda | `%APPDATA%\Nobi\agenda.json` |
| History | `%LOCALAPPDATA%\Nobi\audit.jsonl` (+ `audit.1.jsonl`) |
| Log | `%LOCALAPPDATA%\Nobi\nobi.log` |
| Claude Code hooks | `%USERPROFILE%\.claude\settings.json` (backups: `settings.json.bak-*`) |
| Codex hooks | `%CODEX_HOME%\hooks.json`, or `%USERPROFILE%\.codex\hooks.json` (backups: `hooks.json.bak-*`) |
| Cursor hooks | `%USERPROFILE%\.cursor\hooks.json` (backups: `hooks.json.bak-*`) |

The buttons on **Settings → About** show these files in File Explorer.

## 11. Troubleshooting

### The island doesn't show my sessions

- Run **Settings → Claude Code → Health check** and read the line marked ✗.
- **Did you restart the Claude Code session** after installing the hooks? Open sessions don't see
  new hooks.
- Is Claude Code running inside WSL? Its settings then live on the Linux side; Nobi currently
  supports Claude Code running on the same system as the app — install Nobi inside the Linux
  side (WSLg shows its window) or run Claude Code on Windows.
- If the hooks were removed later, Nobi says so at start-up; reinstall them from
  **Settings → Claude Code**.

### Health check: the relay is missing

Quit and restart Nobi; the relay is put back on every start. If your antivirus quarantined
`%LOCALAPPDATA%\Nobi\bin\nobi-hook.exe`, restore it and add an exclusion. Nobi won't
install hooks while the relay is missing, because every hook would then fail.

### Health check: the ping never reached the pipe

Make sure Nobi is running (the owl in the tray). Another security product may be blocking named
pipes. If it persists, open an issue with the last lines of `%LOCALAPPDATA%\Nobi\nobi.log`.

### Approval refused: not a physical click

The card says *"That approval didn't come from a physical click and was refused"*. The physical
click guard checks that an approval comes from a real mouse press on the button, and these may not
produce one:

- a touchscreen or a pen,
- remote desktop and remote-control software,
- accessibility tools such as on-screen keyboards or voice control.

If you use one of them, switch off **Settings → Safety → Physical click guard**. It then stops
checking LOW and MEDIUM approvals; HIGH and CRITICAL ones always need a real press and hold, so
decide those in the terminal (**Hand to terminal**) when you can't give one.

**On a laptop touchpad:** some Windows laptops' precision touchpads report presses without naming
the device they came from, which is also what a program's fake click looks like, so Nobi
refuses them. If a touchpad click is refused, look in `%LOCALAPPDATA%\Nobi\nobi.log` for a
line saying *a press without a device handle counts as synthetic*. If it is there, approve with a
mouse, or switch the guard off as above. Please also open an issue with your laptop model, so the
guard can learn to recognise it.

If it refuses ordinary mouse clicks, please open an issue — that would be a bug. If you swapped the
mouse buttons (left-handed), the guard follows the primary button you chose.

> If you see this warning **without having clicked**, a program on your machine tried to approve on
> your behalf. Deny the request and check what was running.

### Shortcuts don't work

**Settings → Notifications → Shortcuts** shows the state of each one. "Couldn't register" means another
app already uses those keys; pick a different combination.

### No sounds or notifications

Do not disturb, quiet hours or full-screen quiet may be on (the island's header says so). Quiet
hours with the same start and end time never apply. Windows **Focus / Do not disturb** also hides
Nobi's notifications. With the default settings, Nobi sends a notification only while the
island isn't open (**Settings → Notifications**).

### The island is on the wrong screen or covers something

Change **Position** (left / centre / right) and **Display** (main display / display with the
pointer) in **Settings → General**.

### Cursor asks about every command, or blocks every command

When Nobi gives no answer for a Cursor request — it is closed or paused, you handed the request
back, or it timed out — Cursor asks you itself. That's expected. If Cursor *blocks* every shell
and MCP command instead, its hooks point at a relay that can't run, usually because Nobi was
removed without removing the Cursor connection: reinstall Nobi and use **Settings → Other agents
→ Remove connection…**, or delete the entries that mention `nobi-hook` from
`~/.cursor/hooks.json` (or restore one of its `hooks.json.bak-*` backups).

### In the Claude desktop app, commands wait for the island

The Claude desktop app never runs Claude Code's `PermissionRequest` hook, so Nobi asks from
`PreToolUse`. That hook fires before the app's own permission check, so even commands your Claude
permission rules already allow wait for the island; nobody answering means up to 108 seconds
before the app goes on as it would have. Before leaving a desktop-app session to run unattended,
pause Nobi from the tray (requests then pass straight back), or let LOW requests through with a
trusted project or rules.

### My settings were reset, and a `.unreadable-…` file appeared

If Nobi can't use `settings.json` as it is (a hand edit that broke the JSON or gave a value the
wrong type, a disk error), it starts with the defaults — or, when only some values are unreadable,
with every value it could read — copies the file to `settings.json.unreadable-<date>` next to it,
and opens Settings to say what happened. Until you restart, it doesn't save over the original. Fix
or restore the file, then restart Nobi.

`agenda.json` gets the same care. A byte-order mark or one bad entry costs only that entry; when
the file can't be kept exactly as it was, it is copied to `agenda.json.unreadable-<date>` before
anything is saved; and a file that exists but can't be read (locked, or no permission) is never
written over: adding or changing items is refused with a message until it can be read again. The
agenda holds up to 300 items; when it is full, the oldest finished item makes room for a new one,
and with none finished the new one is refused with a message.

### Start with Windows turned itself off

Nobi checks Windows' own entry at every start. If you switched Nobi off in Task Manager's
**Startup apps** (**Startup** on Windows 10), or something else removed the entry, **Settings →
General → Start with Windows** turns off to match instead of overriding your choice. Switch it on
again there if you want it back.

### "Hooks run only where Claude Code uses Git Bash"

Claude Code runs hooks in Git Bash, or in PowerShell when it can't find Git Bash (the Claude desktop
app often can't). Nobi writes its hook command so that it runs in both — unless the relay's path
in your user folder has characters no command can carry through both shells: a `$`, a backtick, an
apostrophe, brackets and other punctuation, or spaces on a drive that keeps no short (8.3) names.
Then the hooks are written for Git Bash only, **Settings → Claude Code** says so, and
`nobi.log` notes it at every start. Claude Code in a terminal or VS Code with Git for Windows
installed still reaches Nobi; where hooks run in PowerShell, such as in the desktop app, its
requests don't.

### The island takes the focus or shows up in Alt-Tab

It shouldn't: on Windows the island and the desktop mascot stay out of Alt-Tab and Task View, and
clicking them leaves your terminal or editor active. Only the island's text boxes — the assistant,
the session search, the agenda, and the answer and note boxes on question and plan cards — take
the keyboard, while you type in them. If you see otherwise, please open an issue with your Windows
version.

### Windows Defender flags the installer

New unsigned programs can trip machine-learning false positives. Check the fingerprint against
`SHA256SUMS.txt` first. If it matches, open an issue — reporting the file to Microsoft as a false
positive helps too.

### I deleted Nobi by hand and Claude Code reports a hook error on every step

The hooks point at a file that's gone. The easiest fix is to reinstall Nobi and remove the hooks
with **Settings → Claude Code → Remove…** (and **Remove connection…** under ChatGPT and Other agents
if you connected them), or uninstall it the normal way. You can also restore one of the
`~/.claude/settings.json.bak-*` backups.

### More help

- Log file: `%LOCALAPPDATA%\Nobi\nobi.log`
- Bug reports: [Issues](https://github.com/tahap0l/nobi/issues)
- Security vulnerabilities: please use [private reporting](https://github.com/tahap0l/nobi/security/advisories/new)
  instead of a public issue ([SECURITY.md](../SECURITY.md))

## 12. Build from source

You need [Rust](https://rustup.rs) with the MSVC toolchain, Node.js 22+, and the
[Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with the
"Desktop development with C++" workload.

```powershell
git clone https://github.com/tahap0l/nobi.git
cd nobi
npm ci
npm test          # Rust tests (also builds the relay)
npm run pack      # → release\Nobi-<version>-setup.exe
```

On a Mac: install the Xcode Command Line Tools (`xcode-select --install`), Rust with both Apple
targets (`rustup target add aarch64-apple-darwin x86_64-apple-darwin`) and Node.js 22 or newer,
then `npm ci`, `npm test` and `npm run pack:mac` (→ `release/Nobi-<version>-macos-universal.dmg`).

On Linux: Rust, Node.js 22 or newer and the development packages listed in the
[README](../README.md#build-from-source), then `npm ci`, `npm test` and `npm run pack:linux`.

Build the app with these scripts, or with `npm run tauri build`. A plain `cargo build --release`
makes a development build that loads its pages from a dev server at `http://localhost:1420` and,
without one, shows only "Could not connect to localhost"; [CONTRIBUTING.md](../CONTRIBUTING.md#setting-up)
shows how to build the app by hand. See [CONTRIBUTING.md](../CONTRIBUTING.md) for more.

## macOS

The setup wizard, connecting Claude Code, trying
it out, the suggested settings and most of the troubleshooting (sections 4–7 and 11) work the same
way on a Mac. This section covers what's different.

### Requirements

| | |
| --- | --- |
| macOS | 11 Big Sur or later, on Apple silicon or Intel (one universal app) |
| Claude Code | Running on the Mac itself: Terminal, iTerm2, VS Code, Cursor, the Claude desktop app… |
| Rights | Nothing beyond dragging an app into Applications |

### Download and verify

1. From the [latest release](https://github.com/tahap0l/nobi/releases/latest),
   download `Nobi-x.y.z-macos-universal.dmg` and `SHA256SUMS.txt`.
2. Check the download in Terminal:

   ```sh
   cd ~/Downloads
   shasum -a 256 Nobi*macos-universal.dmg
   grep macos SHA256SUMS.txt
   ```

   The value must be the one listed for that file. If it differs, don't open the file — download
   it again.

### Install and open it the first time

1. Open the disk image, drag the owl into **Applications**, then eject the disk image. (Finder may
   call the app Nobi or Nobi; on disk it is always `/Applications/Nobi.app`.)
2. Open it from Applications or Spotlight. Releases aren't notarized by Apple yet, so the first
   time macOS stops it:
   - **macOS 15 Sequoia and later:** a message says Apple could not verify that the app is free of
     malware. Choose **Done**. Open **System Settings → Privacy & Security**, scroll down to the
     line saying the app was blocked to protect your Mac, click **Open Anyway**, confirm with your
     password or Touch ID, and choose **Open Anyway** once more.
   - **macOS 14 and earlier:** Control-click the app in Applications, choose **Open**, then
     **Open** again.

   You do this once, and again after each update.
3. **"… is damaged and can't be opened"?** That's the download's quarantine flag talking, not real
   damage. Once you've checked the SHA-256, clear the flag in Terminal and open it again:

   ```sh
   xattr -dr com.apple.quarantine /Applications/Nobi.app
   ```

   (When an agent asks to run this, Nobi scores it CRITICAL, because it changes Nobi's own
   app — here it's you, for an app you've just verified.)
4. Allow notifications when macOS asks. You can change it later in **System Settings →
   Notifications**.

The owl says hello just below the menu bar, and the setup wizard opens — carry on with
[section 4](#4-first-run-and-the-setup-wizard).

### What's different on a Mac

- **A menu bar app.** No Dock icon and not in ⌘-Tab; Nobi's menu sits in the menu bar, under an
  owl that follows the menu bar's light or dark look.
- **The island sits below the menu bar.** On a MacBook with a notch nothing hides behind the
  camera housing.
- **Shortcuts.** Ctrl is ⌃ Control and Alt is ⌥ Option, so the defaults are ⌃⌥N (open the
  island) and ⌃⌥D (deny). Your own shortcuts may use ⌘ too. macOS ties a shortcut to the key's
  position, so letters are named as on a US keyboard.
- **Go to window** brings the session's app (Terminal, iTerm2, VS Code…) to the front, not one
  particular window or tab.
- **The island never takes focus.** It is a floating panel: clicking it leaves your terminal the
  active app. Only its text boxes (the assistant, the session search, the agenda, and the answer
  and note boxes on question and plan cards) take the keyboard, while you type in them.
- **Quiet in full screen** works as on Windows: a full-screen video, game or presentation in
  front keeps Nobi silent.
- **The media card** shows Spotify and Music while one of them is open. The first time macOS asks
  whether Nobi may control that app (**System Settings → Privacy & Security → Automation**).
  A closed player is never started.
- **The click guard** checks that an approval click came from a real mouse or trackpad: macOS
  marks every mouse event with who made it. A program can only fake clicks if you've given it
  Accessibility access (**System Settings → Privacy & Security → Accessibility**), so keep that
  list short.
- **Start at login** adds a LaunchAgent for Nobi.

### Update

Download the new disk image and check it, quit Nobi from the menu bar, drag the new app into
Applications and choose **Replace**. You may have to confirm **Open Anyway** once more. Your
settings, agenda, history and hooks stay. Coming from 2.4.1 or earlier, the desktop mascot may move,
or go back to its corner, once: its position is now kept in points, which stay right on displays
with different scaling.

### Uninstall

Nobi's hooks live in other programs' settings files, so take them out before the app goes.
While the relay is still in place a forgotten hook does no harm, but once the relay is deleted
Claude Code reports a hook error on every step, and Cursor — whose permission hooks are
fail-closed — blocks every shell and MCP command.

1. In Terminal, run:

   ```sh
   /Applications/Nobi.app/Contents/MacOS/nobi --remove-hooks
   ```

   It removes only Nobi's own entries from `~/.claude/settings.json`, Codex's `hooks.json` and
   `~/.cursor/hooks.json`, with a dated backup next to each, and shows no diff. (If an agent asks to
   run it, Nobi scores it CRITICAL — here it's you.) To review each change instead, use
   **Settings → Claude Code → Remove…**, **Settings → ChatGPT → Remove connection…** and
   **Settings → Other agents → Remove connection…**.
2. If **Start at login** is on, switch it off in **Settings → General**.
3. Quit Nobi from the menu bar and move the app from Applications to the Bin.
4. To remove every trace, also delete `~/Library/Application Support/Nobi`.

### Where things live

| What | Where |
| --- | --- |
| App | `/Applications/Nobi.app` |
| Preferences | `~/Library/Application Support/Nobi/settings.json` |
| Agenda | `~/Library/Application Support/Nobi/agenda.json` |
| History | `~/Library/Application Support/Nobi/audit.jsonl` (+ `audit.1.jsonl`) |
| Log | `~/Library/Application Support/Nobi/nobi.log` |
| Relay | `~/Library/Application Support/Nobi/bin/nobi-hook` |
| Relay socket | `~/Library/Application Support/Nobi/nobi.sock` |
| Claude Code hooks | `~/.claude/settings.json` (backups: `settings.json.bak-*`) |
| Codex and Cursor hooks | `$CODEX_HOME/hooks.json` or `~/.codex/hooks.json`; `~/.cursor/hooks.json` (backups: `hooks.json.bak-*`) |

Finder hides `~/Library`: choose **Go → Go to Folder…** (⇧⌘G) and paste the path, or use the
buttons on **Settings → About**.

### Troubleshooting on a Mac

- **The island doesn't show my sessions.** Run the health check and restart Claude Code, as in
  [section 11](#11-troubleshooting).
- **Approval refused: not a physical click.** Screen Sharing and other remote-control tools,
  Universal Control (another Mac's keyboard and mouse) and accessibility tools such as Voice
  Control or Switch Control send clicks that macOS marks as coming from a program. Use the Mac's
  own mouse or trackpad, or switch off **Settings → Safety → Physical click guard** (LOW and
  MEDIUM only; HIGH and CRITICAL always need a real hold). If an ordinary trackpad click is
  refused, please open an issue.
- **No notifications.** Allow them in **System Settings → Notifications**; a Focus mode can hide
  them too.
- **The media card shows nothing, or can't control the player.** Allow Nobi under **System
  Settings → Privacy & Security → Automation**.
- **Shortcuts don't work.** **Settings → Notifications → Shortcuts** shows whether another app
  already owns a combination.
- **The island is on the wrong display.** Change **Display** in **Settings → General**.
- **Start at login turned itself off.** Nobi checks its login entry at every start; if
  something outside Nobi removed it, the switch in **Settings → General** turns off to match.
  Switch it on again there.

## Linux

The setup wizard, connecting Claude Code, trying it out, the suggested settings and most of the
troubleshooting (sections 4–7 and 11) work the same way on Linux.

### Requirements

| | |
| --- | --- |
| Distribution | x86-64 with WebKitGTK 4.1: Ubuntu 22.04+, Debian 12+, Fedora 38+, Arch… |
| Desktop | X11, or Wayland through XWayland (GNOME, KDE Plasma, Xfce, Cinnamon…) — see [Wayland](#wayland) |
| Compositor | On X11, a compositing window manager: the island is a transparent window. GNOME, KDE Plasma and Cinnamon have one built in; on Xfce turn on **Window Manager Tweaks → Compositor**; on a bare window manager run one such as `picom`. Without one, Nobi cuts its window down to the island (square corners, no shadow), and the desktop mascot's down to the mascot and a narrow edge around it |
| Tray | GNOME needs the AppIndicator extension (Ubuntu has it already); most other desktops have a tray |

### Install

Download the `.deb` or the AppImage and `SHA256SUMS.txt` from the
[latest release](https://github.com/tahap0l/nobi/releases/latest), and check them in the
download folder:

```sh
sha256sum --check --ignore-missing SHA256SUMS.txt
```

Every file you downloaded must say `OK`. Then either install the package:

```sh
sudo apt install ./Nobi-x.y.z-linux-amd64.deb
```

or make the AppImage executable and run it:

```sh
chmod +x Nobi-x.y.z-linux-amd64.AppImage
./Nobi-x.y.z-linux-amd64.AppImage
```

### What's different on Linux

- **The window runs through X11.** Under Wayland, Nobi starts itself on XWayland so the island
  can sit at the top of the screen and stay above other windows. Programs it opens for you — a link
  in your browser, VS Code, the file manager — start the way they always do, natively on Wayland,
  and from the AppImage they get your desktop's own settings, not the ones the AppImage set up for
  itself (its GTK theme and modules, its GStreamer plugins).
- **The island doesn't take the keyboard.** Clicking it leaves your terminal focused; only its text
  boxes (the assistant, the session search, the agenda, and the answer and note boxes on question
  and plan cards) take the keyboard, while you type in them. When you leave the box — close it, or
  let the island fold — the keyboard goes back to the window that had it before.
- **HIGH and CRITICAL are approved in the terminal.** X11 lets any program running as you click
  through the real mouse, and nothing in such a click tells it from yours, so the island never
  approves a HIGH or CRITICAL request on Linux. Its card says why and offers **Hand to terminal**
  (**Hand to Cursor** for a Cursor request) and **Deny**: answer in the terminal, or in Cursor.
  LOW and MEDIUM requests are approved on the island as everywhere else.
- **The click guard** reads XInput2 raw events and asks the X server about the device behind every
  press: clicks from an XTEST device — what `xdotool` and similar tools use, including one a
  program adds later — are refused. It can't catch a program that presses through the real mouse
  device, which is why it only guards LOW and MEDIUM approvals here.
- **Go to window** asks the window manager to raise the window that belongs to the session's
  process chain.
- **The media card** works with every MPRIS player — Spotify, VLC, Firefox, Chromium, mpv with
  its MPRIS plugin. It only talks to a player that is already running; it never starts one.
- **No voice input.** Linux has no system dictation, so the assistant has no 🎙 button there.
- **Notifications** show a command as plain text, even where the notification server reads
  markup: nothing in it can turn into a link.
- **Secrets** (an optional OpenAI key) go to the Secret Service (GNOME Keyring, KWallet).

### Wayland

On a Wayland session (the default on current Ubuntu, Fedora and KDE Plasma), Nobi's window runs
on XWayland and sees only what X11 shows it:

- **Global shortcuts** work only while an X11 (XWayland) window has the focus. Use the tray menu,
  or click the island, when a native Wayland window is in front.
- **Go to window** can't find terminals and editors that run natively on Wayland (GNOME Terminal,
  Konsole and many more); it opens the session's folder instead.
- **Quiet in full screen** doesn't notice native Wayland apps in full screen. Use Do not disturb
  for presentations.
- **The click guard** still refuses XTEST clicks from X11 programs. Input the compositor itself
  injects reaches XWayland as ordinary pointer input, though. GNOME and KDE inject only after a
  remote-desktop prompt; wlroots compositors (sway, Hyprland, river…) let any program inject
  through their virtual-pointer protocol, and there the guard can't tell such a click from yours.

Logging in to an X11 session (where your desktop offers one) avoids all four. HIGH and CRITICAL
requests are approved in the terminal on X11 too.

### Update

Download the new files and check them as above. Quit Nobi from the tray, then install the new
`.deb` with `sudo apt install ./Nobi-x.y.z-linux-amd64.deb`, or replace the AppImage. If
**Start at login** is on and the new AppImage has a different file name, start the new one once by
hand: Nobi points its login entry at the AppImage it was started from. Only that path changes in
the entry's `Exec=` line; what you added around it (`env …`, `--minimized`) stays, and a wrapper
script of your own there is left alone. Settings, agenda, history and hooks stay.

### Uninstall

The package manager runs as root and can't take the hooks out of your home folder, so do that
first. While the relay is still in place a forgotten hook does no harm, but once the relay is
deleted Claude Code reports a hook error on every step and Cursor blocks every shell and MCP
command.

1. Remove the hooks:

   ```sh
   nobi --remove-hooks                                # the .deb
   ./Nobi-x.y.z-linux-amd64.AppImage --remove-hooks   # the AppImage
   ```

   It removes only Nobi's own entries from `~/.claude/settings.json`, Codex's `hooks.json` and
   `~/.cursor/hooks.json`, with a dated backup next to each, and shows no diff. (If an agent asks to
   run it, Nobi scores it CRITICAL — here it's you.) To review each change instead, use
   **Settings → Claude Code → Remove…**, **Settings → ChatGPT → Remove connection…** and
   **Settings → Other agents → Remove connection…**.
2. If **Start at login** is on, switch it off in **Settings → General** (it is
   `~/.config/autostart/Nobi.desktop`).
3. Quit Nobi from the tray, then `sudo apt remove nobi`, or delete the AppImage.
4. To remove every trace, also delete `~/.config/nobi`, `~/.local/share/nobi` and
   `~/.local/state/nobi`.

### Where things live

| | |
| --- | --- |
| Settings and agenda | `~/.config/nobi` (`$XDG_CONFIG_HOME/nobi` when that is set) |
| History, log and the relay | `~/.local/share/nobi` (`$XDG_DATA_HOME/nobi` when that is set) |
| The relay's socket | `~/.local/state/nobi/nobi.sock` (`/tmp/nobi-<uid>/` as a fallback) |
| Start at login | `~/.config/autostart/Nobi.desktop` |
| The app (`.deb`) | `/usr/bin/nobi` |
| Claude Code, Codex and Cursor hooks | `~/.claude/settings.json`, `$CODEX_HOME/hooks.json` or `~/.codex/hooks.json`, `~/.cursor/hooks.json` |

### Troubleshooting on Linux

- **A black box at the top of the screen, or square corners.** There is no compositor, so the
  island can't be transparent. Versions after 2.4.1 cut the window down to the island instead
  (square corners, no shadow), and the desktop mascot's down to the mascot and a narrow edge around
  it, and say so once in the log. Turn on your desktop's compositor or start one (`picom`,
  `xcompmgr`), and Nobi switches to the full look by itself.
- **No tray icon on GNOME.** Install and enable the AppIndicator extension.
- **No sounds from the AppImage.** AppImages up to 2.4.1 carry no GStreamer audio plugins; later
  ones do. Use the `.deb`, or a newer AppImage.
- **Shortcuts, Go to window or full-screen quiet don't work.** You are probably on Wayland: see
  [Wayland](#wayland).
- **Start at login turned itself off.** Nobi checks `~/.config/autostart/Nobi.desktop` at
  every start; if your desktop's autostart settings removed it or switched it off (`Hidden=true`,
  `X-GNOME-Autostart-enabled=false`), the switch in **Settings → General** turns off to match.
  Switch it on again there.
- **A HIGH or CRITICAL card has no Allow button.** That is on purpose on Linux (see
  [What's different on Linux](#whats-different-on-linux)): choose **Hand to terminal** and answer
  in the terminal, or deny the request.
- **Approval refused: not a physical click.** Remote-desktop tools and `xdotool` send XTEST
  clicks, which the guard refuses. Use the real mouse, or switch off **Settings → Safety →
  Physical click guard** (LOW and MEDIUM only). If you swapped the mouse buttons (left-handed,
  with `xmodmap` or `xinput`), the guard follows the button that acts as the primary click.
- **The log** is `~/.local/share/nobi/nobi.log`.
