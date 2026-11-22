# Installing Nöbetçi

**English** · [Türkçe](kurulum.md)

This guide walks through every step, from downloading Nöbetçi to connecting it to Claude Code,
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
| Rights | **No** administrator rights needed; Nöbetçi installs for your account only. |

## 2. Download and verify

1. From the [latest release](https://github.com/tahap0l/nobetci/releases/latest), download:
   - `Nobetci-x.y.z-setup.exe` — the installer (`x.y.z` is the version; releases after 2.4.1
     also carry the same file as `Nobetci-setup.exe`)
   - `SHA256SUMS.txt` — the fingerprints of every file in the release
2. Check that your download is the published file. Open PowerShell in the download folder and run:

   ```powershell
   Get-FileHash .\Nobetci*setup.exe -Algorithm SHA256
   Get-Content .\SHA256SUMS.txt
   ```

   The long value must be **identical** to the one listed for that file (case doesn't matter). If
   it differs, don't run the file — download it again.

Releases aren't code-signed yet (see the [code signing policy](../CODE_SIGNING_POLICY.md)), so this
check is what tells you the file is the one that was published.

## 3. Install

1. Double-click `Nobetci-x.y.z-setup.exe`.
2. **"Windows protected your PC"?** Releases aren't code-signed yet, so SmartScreen doesn't know the
   file. Once you've checked the fingerprint, choose **More info → Run anyway**.
3. Installation takes a few seconds and goes into `%LOCALAPPDATA%\Nobetci`. It shows up in the Start
   menu as **Nobetci**. The installer speaks Turkish on a Turkish Windows and English everywhere
   else.

> Silent install: `.\Nobetci-x.y.z-setup.exe /S` (with your version in place of `x.y.z`).

## 4. First run and the setup wizard

Start Nöbetçi from the Start menu. An owl appears at the top centre of the screen and says hello,
then the island folds away and Nöbetçi keeps watch from the notification area next to the clock.

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

Nöbetçi sees Claude Code through **hooks**, added to `~/.claude/settings.json`
(`C:\Users\<you>\.claude\settings.json`) — or to `settings.json` in the folder `CLAUDE_CONFIG_DIR`
names, if you keep Claude Code's settings there.

1. Start from the wizard's **Connect** step, or **Settings → Claude Code → Install hooks…**.
2. Nöbetçi shows the change to the file as a **diff**: added lines in green. Your other settings and
   other tools' hooks stay as they are. While the preview is open, nothing else on the page can
   change what will be written.
3. Look it over and click **Approve and write**. A dated backup is saved next to the file first
   (`settings.json.bak-YYYYMMDD-HHMMSS`). If the file changed after the preview, Nöbetçi refuses and
   offers a fresh preview.
4. Press **Settings → Claude Code → Health check**. Every line should be ✓:
   - the hooks are in `settings.json`, `PermissionRequest` and `PreToolUse` among them,
   - the relay (`nobetci-hook.exe`) is in place,
   - a ping gets through the pipe (a few milliseconds),
   - the physical click guard is ready.
5. **Restart any Claude Code session that was already open.** Claude Code reads hooks when a
   session starts.

`PreToolUse` matters more than it looks: it carries the questions and plans the island answers, and
in the Claude desktop app — which never runs `PermissionRequest` — every approval. Leave it on.

### Codex, ChatGPT Work and Cursor (optional)

- **Codex and ChatGPT Work:** **Settings → ChatGPT → Connect…** writes Nöbetçi's hooks into Codex's
  `hooks.json` (in `$CODEX_HOME`, or `~/.codex`) after the same kind of reviewed diff. Then review
  and trust the hooks in the ChatGPT desktop app under **Settings → Hooks** (if the list is empty,
  add a local project in the Codex view and refresh it), or with `/hooks` in the Codex CLI. Send a
  message in a new local chat and run **Health check** to see it arrive. Work Cloud doesn't run
  local hooks.
- **Cursor:** **Settings → Other agents → Connect…** writes `~/.cursor/hooks.json`. When Nöbetçi
  gives no answer for a Cursor shell or MCP request — it is closed or paused, you handed the
  request back, or it timed out — Cursor asks you itself. Nöbetçi registers its Cursor permission
  hooks *fail-closed*, though: if the relay itself can't run, Cursor blocks the command. Remove the
  connection before you remove Nöbetçi (see [Uninstall](#9-uninstall)).

## 6. Try it

1. Start a new Claude Code session. The island briefly says the session started; move the mouse to
   the top centre of the screen to see it as a row.
2. Ask Claude for something that needs permission, such as running a command you haven't allowed
   before.
3. The island opens with an **approval card**: the whole command, its risk level and the reasons.
4. Click **Allow** as usual. For HIGH and CRITICAL requests, keep the button pressed until the bar
   fills. A card that has only just appeared ignores clicks for a moment, so a stray double-click
   can't approve it.

You can also type a command into **Settings → Safety → Try the risk engine** to see how it's scored,
without running anything.

For a message to any AI agent, open **Settings → Prompt Studio**, choose the target and review a
draft. Local Ollama is the default; Ollama models marked **cloud** may forward the draft. To use
OpenAI, select it and add your key; Nöbetçi stores the key in the operating system credential vault.
The rewritten message is shown for review and copied only when you ask. Paste it into the target app
yourself; Nöbetçi does not read or send messages in other apps automatically.

## 7. Suggested first settings

| Setting | Where | Suggestion |
| --- | --- | --- |
| Start with Windows | Settings → General | On — while Nöbetçi is closed, questions fall back to the terminal. |
| Auto-allow ceiling | Settings → Safety | **LOW only** (the default). HIGH and CRITICAL are never approved automatically anyway. |
| Physical click guard | Settings → Safety | On (the default). Using a touchscreen, a laptop touchpad or an accessibility tool? See [troubleshooting](#approval-refused-not-a-physical-click). |
| Rules | Settings → Rules | Start from the templates: allow `npm test`, block force push, keep it out of `.env` files. |
| Shortcuts | Settings → Notifications | Ctrl+Alt+N opens the island, Ctrl+Alt+D denies the request on the card. |
| Do not disturb | The button in the island's header, or the tray menu | During a presentation or a game. Full screen goes quiet by itself. |

## 8. Update

Download the new installer (check its fingerprint) and run it. Nöbetçi closes during the update;
start it again when the installer is done.

Installing another version over the current one — newer or older — is an update, not an
uninstall: your settings, agenda and history, your Claude Code, Codex and Cursor hooks and
**Start with Windows** are all kept, whichever version you update from. Only choosing to uninstall,
on the page the installer shows when you run the version you already have, removes them.

If a new version changes what the hooks need, **Settings → Claude Code** (or **ChatGPT**, **Other
agents**) says the connection is out of date; review the diff and update it there.

## 9. Uninstall

Open **Settings → Apps → Installed apps** (**Apps & features** on Windows 10), find **Nobetci** and
choose **Uninstall**. The uninstaller:

1. asks you to close Nöbetçi if it is running — **Cancel** there changes nothing at all;
2. runs `nobetci.exe --remove-hooks`, which removes **only Nöbetçi's own** entries from
   `~/.claude/settings.json`, from Codex's `hooks.json` and from `~/.cursor/hooks.json`, after
   saving a dated backup next to each one (`settings.json.bak-…`, `hooks.json.bak-…`). Nothing
   else in those files changes. This is the one write to them without a diff on screen;
3. removes the app, the relay, the log and the **Start with Windows** entries.

If the hooks can't be removed (a read-only or locked file, for example), the uninstaller keeps the
relay and the log, so Claude Code, Codex and Cursor go on working, and shows which entries to delete
by hand; the log says what went wrong.

Your preferences and agenda (`%APPDATA%\Nobetci`) and history (`%LOCALAPPDATA%\Nobetci\audit.jsonl`)
stay, so a reinstall picks up where you left off. Tick **Delete the application data** in the
uninstaller to remove `%APPDATA%\Nobetci`, `%LOCALAPPDATA%\Nobetci` and the WebView's own folders
too.

To review each change instead, remove the connections first in **Settings → Claude Code →
Remove…**, **Settings → ChatGPT → Remove connection…** and **Settings → Other agents → Remove
connection…**.

If you set up the [ChatGPT Web bridge](../integrations/chatgpt-web/README.md), remove its browser
extension too, and its registration in PowerShell (use `Microsoft\Edge` in place of `Google\Chrome`
for Edge):

```powershell
Remove-Item 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\io.github.tahap0l.nobetci.chatgpt'
```

## 10. Where things live

| What | Where |
| --- | --- |
| App | `%LOCALAPPDATA%\Nobetci\` |
| Relay | `%LOCALAPPDATA%\Nobetci\bin\nobetci-hook.exe` |
| Preferences | `%APPDATA%\Nobetci\settings.json` |
| Agenda | `%APPDATA%\Nobetci\agenda.json` |
| History | `%LOCALAPPDATA%\Nobetci\audit.jsonl` (+ `audit.1.jsonl`) |
| Log | `%LOCALAPPDATA%\Nobetci\nobetci.log` |
| Claude Code hooks | `%USERPROFILE%\.claude\settings.json` (backups: `settings.json.bak-*`) |
| Codex hooks | `%CODEX_HOME%\hooks.json`, or `%USERPROFILE%\.codex\hooks.json` (backups: `hooks.json.bak-*`) |
| Cursor hooks | `%USERPROFILE%\.cursor\hooks.json` (backups: `hooks.json.bak-*`) |

The buttons on **Settings → About** show these files in File Explorer.

## 11. Troubleshooting

### The island doesn't show my sessions

- Run **Settings → Claude Code → Health check** and read the line marked ✗.
- **Did you restart the Claude Code session** after installing the hooks? Open sessions don't see
  new hooks.
- Is Claude Code running inside WSL? Its settings then live on the Linux side; Nöbetçi currently
  supports Claude Code running on the same system as the app — install Nöbetçi inside the Linux
  side (WSLg shows its window) or run Claude Code on Windows.
- If the hooks were removed later, Nöbetçi says so at start-up; reinstall them from
  **Settings → Claude Code**.

### Health check: the relay is missing

Quit and restart Nöbetçi; the relay is put back on every start. If your antivirus quarantined
`%LOCALAPPDATA%\Nobetci\bin\nobetci-hook.exe`, restore it and add an exclusion. Nöbetçi won't
install hooks while the relay is missing, because every hook would then fail.

### Health check: the ping never reached the pipe

Make sure Nöbetçi is running (the owl in the tray). Another security product may be blocking named
pipes. If it persists, open an issue with the last lines of `%LOCALAPPDATA%\Nobetci\nobetci.log`.

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
the device they came from, which is also what a program's fake click looks like, so Nöbetçi
refuses them. If a touchpad click is refused, look in `%LOCALAPPDATA%\Nobetci\nobetci.log` for a
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
Nöbetçi's notifications. With the default settings, Nöbetçi sends a notification only while the
island isn't open (**Settings → Notifications**).

### The island is on the wrong screen or covers something

Change **Position** (left / centre / right) and **Display** (main display / display with the
pointer) in **Settings → General**.

### Cursor asks about every command, or blocks every command

When Nöbetçi gives no answer for a Cursor request — it is closed or paused, you handed the request
back, or it timed out — Cursor asks you itself. That's expected. If Cursor *blocks* every shell
and MCP command instead, its hooks point at a relay that can't run, usually because Nöbetçi was
removed without removing the Cursor connection: reinstall Nöbetçi and use **Settings → Other agents
→ Remove connection…**, or delete the entries that mention `nobetci-hook` from
`~/.cursor/hooks.json` (or restore one of its `hooks.json.bak-*` backups).

### In the Claude desktop app, commands wait for the island

The Claude desktop app never runs Claude Code's `PermissionRequest` hook, so Nöbetçi asks from
`PreToolUse`. That hook fires before the app's own permission check, so even commands your Claude
permission rules already allow wait for the island; nobody answering means up to 108 seconds
before the app goes on as it would have. Before leaving a desktop-app session to run unattended,
pause Nöbetçi from the tray (requests then pass straight back), or let LOW requests through with a
trusted project or rules.

### My settings were reset, and a `.unreadable-…` file appeared

If Nöbetçi can't read `settings.json` (a hand edit that broke the JSON, a disk error), it starts
with the defaults, copies the file to `settings.json.unreadable-<date>` next to it and says so in
Settings. Until you restart, it doesn't save over the original. Fix or restore the file, then
restart Nöbetçi. `agenda.json` is treated with the same care: an entry it can't read is skipped
and the rest are kept, and a file it can't read at all is copied to
`agenda.json.unreadable-<date>` before anything is saved.

### Windows Defender flags the installer

New unsigned programs can trip machine-learning false positives. Check the fingerprint against
`SHA256SUMS.txt` first. If it matches, open an issue — reporting the file to Microsoft as a false
positive helps too.

### I deleted Nöbetçi by hand and Claude Code reports a hook error on every step

The hooks point at a file that's gone. The easiest fix is to reinstall Nöbetçi and remove the hooks
with **Settings → Claude Code → Remove…** (and **Remove connection…** under ChatGPT and Other agents
if you connected them), or uninstall it the normal way. You can also restore one of the
`~/.claude/settings.json.bak-*` backups.

### More help

- Log file: `%LOCALAPPDATA%\Nobetci\nobetci.log`
- Bug reports: [Issues](https://github.com/tahap0l/nobetci/issues)
- Security vulnerabilities: please use [private reporting](https://github.com/tahap0l/nobetci/security/advisories/new)
  instead of a public issue ([SECURITY.md](../SECURITY.md))

## 12. Build from source

You need [Rust](https://rustup.rs) with the MSVC toolchain, Node.js 22+, and the
[Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with the
"Desktop development with C++" workload.

```powershell
git clone https://github.com/tahap0l/nobetci.git
cd nobetci
npm ci
npm test          # Rust tests (also builds the relay)
npm run pack      # → release\Nobetci-<version>-setup.exe
```

On a Mac: install the Xcode Command Line Tools (`xcode-select --install`), Rust with both Apple
targets (`rustup target add aarch64-apple-darwin x86_64-apple-darwin`) and Node.js 22 or newer,
then `npm ci`, `npm test` and `npm run pack:mac` (→ `release/Nobetci-<version>-macos-universal.dmg`).

On Linux: Rust, Node.js 22 or newer and the development packages listed in the
[README](../README.md#build-from-source), then `npm ci`, `npm test` and `npm run pack:linux`.

See [CONTRIBUTING.md](../CONTRIBUTING.md) for more.

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

1. From the [latest release](https://github.com/tahap0l/nobetci/releases/latest),
   download `Nobetci-x.y.z-macos-universal.dmg` and `SHA256SUMS.txt`.
2. Check the download in Terminal:

   ```sh
   cd ~/Downloads
   shasum -a 256 Nobetci*macos-universal.dmg
   grep macos SHA256SUMS.txt
   ```

   The value must be the one listed for that file. If it differs, don't open the file — download
   it again.

### Install and open it the first time

1. Open the disk image, drag the owl into **Applications**, then eject the disk image. (Finder may
   call the app Nöbetçi or Nobetci; on disk it is always `/Applications/Nobetci.app`.)
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
   xattr -dr com.apple.quarantine /Applications/Nobetci.app
   ```

   (When an agent asks to run this, Nöbetçi scores it HIGH — here it's you, for an app you've
   just verified.)
4. Allow notifications when macOS asks. You can change it later in **System Settings →
   Notifications**.

The owl says hello just below the menu bar, and the setup wizard opens — carry on with
[section 4](#4-first-run-and-the-setup-wizard).

### What's different on a Mac

- **A menu bar app.** No Dock icon and not in ⌘-Tab; Nöbetçi's menu sits in the menu bar.
- **The island sits below the menu bar.** On a MacBook with a notch nothing hides behind the
  camera housing.
- **Shortcuts.** Ctrl is ⌃ Control and Alt is ⌥ Option, so the defaults are ⌃⌥N (open the
  island) and ⌃⌥D (deny). Your own shortcuts may use ⌘ too. macOS ties a shortcut to the key's
  position, so letters are named as on a US keyboard.
- **Go to window** brings the session's app (Terminal, iTerm2, VS Code…) to the front, not one
  particular window or tab.
- **The island never takes focus.** It is a floating panel: clicking it leaves your terminal the
  active app. Only the assistant's text box takes the keyboard, while you type in it.
- **Quiet in full screen** works as on Windows: a full-screen video, game or presentation in
  front keeps Nöbetçi silent.
- **The media card** shows Spotify and Music while one of them is open. The first time macOS asks
  whether Nöbetçi may control that app (**System Settings → Privacy & Security → Automation**).
  A closed player is never started.
- **The click guard** checks that an approval click came from a real mouse or trackpad: macOS
  marks every mouse event with who made it. A program can only fake clicks if you've given it
  Accessibility access (**System Settings → Privacy & Security → Accessibility**), so keep that
  list short.
- **Start at login** adds a LaunchAgent for Nöbetçi.

### Update

Download the new disk image and check it, quit Nöbetçi from the menu bar, drag the new app into
Applications and choose **Replace**. You may have to confirm **Open Anyway** once more. Your
settings, agenda, history and hooks stay.

### Uninstall

Nöbetçi's hooks live in other programs' settings files, so take them out before the app goes.
While the relay is still in place a forgotten hook does no harm, but once the relay is deleted
Claude Code reports a hook error on every step, and Cursor — whose permission hooks are
fail-closed — blocks every shell and MCP command.

1. In Terminal, run:

   ```sh
   /Applications/Nobetci.app/Contents/MacOS/nobetci --remove-hooks
   ```

   It removes only Nöbetçi's own entries from `~/.claude/settings.json`, Codex's `hooks.json` and
   `~/.cursor/hooks.json`, with a dated backup next to each, and shows no diff. (If an agent asks to
   run it, Nöbetçi scores it CRITICAL — here it's you.) To review each change instead, use
   **Settings → Claude Code → Remove…**, **Settings → ChatGPT → Remove connection…** and
   **Settings → Other agents → Remove connection…**.
2. If **Start at login** is on, switch it off in **Settings → General**.
3. Quit Nöbetçi from the menu bar and move the app from Applications to the Bin.
4. To remove every trace, also delete `~/Library/Application Support/Nobetci`.

### Where things live

| What | Where |
| --- | --- |
| App | `/Applications/Nobetci.app` |
| Preferences | `~/Library/Application Support/Nobetci/settings.json` |
| Agenda | `~/Library/Application Support/Nobetci/agenda.json` |
| History | `~/Library/Application Support/Nobetci/audit.jsonl` (+ `audit.1.jsonl`) |
| Log | `~/Library/Application Support/Nobetci/nobetci.log` |
| Relay | `~/Library/Application Support/Nobetci/bin/nobetci-hook` |
| Relay socket | `~/Library/Application Support/Nobetci/nobetci.sock` |
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
- **The media card shows nothing, or can't control the player.** Allow Nöbetçi under **System
  Settings → Privacy & Security → Automation**.
- **Shortcuts don't work.** **Settings → Notifications → Shortcuts** shows whether another app
  already owns a combination.
- **The island is on the wrong display.** Change **Display** in **Settings → General**.

## Linux

The setup wizard, connecting Claude Code, trying it out, the suggested settings and most of the
troubleshooting (sections 4–7 and 11) work the same way on Linux.

### Requirements

| | |
| --- | --- |
| Distribution | x86-64 with WebKitGTK 4.1: Ubuntu 22.04+, Debian 12+, Fedora 38+, Arch… |
| Desktop | X11, or Wayland through XWayland (GNOME, KDE Plasma, Xfce, Cinnamon…) — see [Wayland](#wayland) |
| Compositor | On X11, a compositing window manager: the island is a transparent window. GNOME, KDE Plasma and Cinnamon have one built in; on Xfce turn on **Window Manager Tweaks → Compositor**; on a bare window manager run one such as `picom` |
| Tray | GNOME needs the AppIndicator extension (Ubuntu has it already); most other desktops have a tray |

### Install

Download the `.deb` or the AppImage and `SHA256SUMS.txt` from the
[latest release](https://github.com/tahap0l/nobetci/releases/latest), and check them in the
download folder:

```sh
sha256sum --check --ignore-missing SHA256SUMS.txt
```

Every file you downloaded must say `OK`. Then either install the package:

```sh
sudo apt install ./Nobetci-x.y.z-linux-amd64.deb
```

or make the AppImage executable and run it:

```sh
chmod +x Nobetci-x.y.z-linux-amd64.AppImage
./Nobetci-x.y.z-linux-amd64.AppImage
```

### What's different on Linux

- **The window runs through X11.** Under Wayland, Nöbetçi starts itself on XWayland so the island
  can sit at the top of the screen and stay above other windows.
- **The click guard** reads XInput2 raw events and asks the X server about the device behind every
  press: clicks from an XTEST device — what `xdotool` and similar tools use, including one a
  program adds later — are refused.
- **Go to window** asks the window manager to raise the window that belongs to the session's
  process chain.
- **The media card** works with every MPRIS player — Spotify, VLC, Firefox, Chromium, mpv with
  its MPRIS plugin.
- **No voice input.** Linux has no system dictation, so the assistant has no 🎙 button there.
- **Secrets** (an optional OpenAI key) go to the Secret Service (GNOME Keyring, KWallet).

### Wayland

On a Wayland session (the default on current Ubuntu, Fedora and KDE Plasma), Nöbetçi's window runs
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

Logging in to an X11 session (where your desktop offers one) avoids all four.

### Update

Download the new files and check them as above. Quit Nöbetçi from the tray, then install the new
`.deb` with `sudo apt install ./Nobetci-x.y.z-linux-amd64.deb`, or replace the AppImage. If
**Start at login** is on and the new AppImage has a different file name, switch **Start at login**
off and on again so it points at the new file. Settings, agenda, history and hooks stay.

### Uninstall

The package manager runs as root and can't take the hooks out of your home folder, so do that
first. While the relay is still in place a forgotten hook does no harm, but once the relay is
deleted Claude Code reports a hook error on every step and Cursor blocks every shell and MCP
command.

1. Remove the hooks:

   ```sh
   nobetci --remove-hooks                                # the .deb
   ./Nobetci-x.y.z-linux-amd64.AppImage --remove-hooks   # the AppImage
   ```

   It removes only Nöbetçi's own entries from `~/.claude/settings.json`, Codex's `hooks.json` and
   `~/.cursor/hooks.json`, with a dated backup next to each, and shows no diff. (If an agent asks to
   run it, Nöbetçi scores it CRITICAL — here it's you.) To review each change instead, use
   **Settings → Claude Code → Remove…**, **Settings → ChatGPT → Remove connection…** and
   **Settings → Other agents → Remove connection…**.
2. If **Start at login** is on, switch it off in **Settings → General** (it is
   `~/.config/autostart/Nobetci.desktop`).
3. Quit Nöbetçi from the tray, then `sudo apt remove nobetci`, or delete the AppImage.
4. To remove every trace, also delete `~/.config/nobetci`, `~/.local/share/nobetci` and
   `~/.local/state/nobetci`.

### Where things live

| | |
| --- | --- |
| Settings and agenda | `~/.config/nobetci` (`$XDG_CONFIG_HOME/nobetci` when that is set) |
| History, log and the relay | `~/.local/share/nobetci` (`$XDG_DATA_HOME/nobetci` when that is set) |
| The relay's socket | `~/.local/state/nobetci/nobetci.sock` (`/tmp/nobetci-<uid>/` as a fallback) |
| Start at login | `~/.config/autostart/Nobetci.desktop` |
| The app (`.deb`) | `/usr/bin/nobetci` |
| Claude Code, Codex and Cursor hooks | `~/.claude/settings.json`, `$CODEX_HOME/hooks.json` or `~/.codex/hooks.json`, `~/.cursor/hooks.json` |

### Troubleshooting on Linux

- **A black box at the top of the screen.** There is no compositor, so the island can't be
  transparent. Turn on your desktop's compositor or start one (`picom`), then restart Nöbetçi.
- **No tray icon on GNOME.** Install and enable the AppIndicator extension.
- **No sounds from the AppImage.** AppImages up to 2.4.1 carry no GStreamer audio plugins; later
  ones do. Use the `.deb`, or a newer AppImage.
- **Shortcuts, Go to window or full-screen quiet don't work.** You are probably on Wayland: see
  [Wayland](#wayland).
- **Approval refused: not a physical click.** Remote-desktop tools and `xdotool` send XTEST
  clicks, which the guard refuses. Use the real mouse, or switch off **Settings → Safety →
  Physical click guard** (LOW and MEDIUM only).
- **The log** is `~/.local/share/nobetci/nobetci.log`.
