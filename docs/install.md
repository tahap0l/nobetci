# Installing Nöbetçi

**English** · [Türkçe](kurulum.md)

This guide walks through every step, from downloading Nöbetçi to connecting it to Claude Code,
updating and uninstalling. A troubleshooting section is at the end.

> **On a Mac?** Sections 1–3 and 8–10 describe Windows. Read [macOS](#macos) for those steps —
> the rest is the same on both.

## Contents

1. [Requirements](#1-requirements)
2. [Download and verify](#2-download-and-verify)
3. [Install](#3-install)
4. [First run and the setup wizard](#4-first-run-and-the-setup-wizard)
5. [Connect Claude Code](#5-connect-claude-code)
6. [Try it](#6-try-it)
7. [Suggested first settings](#7-suggested-first-settings)
8. [Update](#8-update)
9. [Uninstall](#9-uninstall)
10. [Where things live](#10-where-things-live)
11. [Troubleshooting](#11-troubleshooting)
12. [Build from source](#12-build-from-source)
13. [macOS](#macos)

## 1. Requirements

| | |
| --- | --- |
| Operating system | Windows 10 or 11, 64-bit — or macOS 11 or later, see [macOS](#macos) |
| Claude Code | Claude Code running on Windows itself (terminal, VS Code, Cursor…). Claude Code inside WSL keeps its settings elsewhere and isn't covered. |
| WebView2 | Part of Windows 11 and current Windows 10; the installer fetches it if it's missing. |
| Rights | **No** administrator rights needed; Nöbetçi installs for your account only. |

## 2. Download and verify

1. From the [latest release](https://github.com/tahap0l/nobetci/releases/latest), download:
   - `Nobetci-x.y.z-setup.exe` — the installer
   - `SHA256SUMS.txt` — its fingerprint
2. Check that your download is the published file. Open PowerShell in the download folder and run:

   ```powershell
   Get-FileHash .\Nobetci-0.2.0-setup.exe -Algorithm SHA256
   Get-Content .\SHA256SUMS.txt
   ```

   The long values must be **identical** (case doesn't matter). If they differ, don't run the file —
   download it again.

## 3. Install

1. Double-click `Nobetci-x.y.z-setup.exe`.
2. **"Windows protected your PC"?** Releases aren't code-signed yet, so SmartScreen doesn't know the
   file. Once you've checked the fingerprint, choose **More info → Run anyway**.
3. Installation takes a few seconds and goes into `%LOCALAPPDATA%\Nobetci`. It shows up in the Start
   menu as **Nobetci**.

> Silent install: `Nobetci-0.2.0-setup.exe /S`

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
(`C:\Users\<you>\.claude\settings.json`).

1. Start from the wizard's **Connect** step, or **Settings → Claude Code → Install hooks…**.
2. Nöbetçi shows the change to the file as a **diff**: added lines in green. Your other settings and
   other tools' hooks stay as they are.
3. Look it over and click **Approve and write**. A dated backup is saved next to the file first
   (`settings.json.bak-YYYYMMDD-HHMMSS`).
4. Press **Settings → Claude Code → Health check**. Every line should be ✓:
   - the hooks are in `settings.json`,
   - the relay (`nobetci-hook.exe`) is in place,
   - a ping gets through the pipe (a few milliseconds),
   - the physical click guard is ready.
5. **Restart any Claude Code session that was already open.** Claude Code reads hooks when a
   session starts.

## 6. Try it

1. Start a new Claude Code session. The island briefly says the session started; move the mouse to
   the top centre of the screen to see it as a row.
2. Ask Claude for something that needs permission, such as running a command you haven't allowed
   before.
3. The island opens with an **approval card**: the whole command, its risk level and the reasons.
4. Click **Allow** as usual. For HIGH and CRITICAL requests, keep the button pressed until the bar
   fills.

You can also type a command into **Settings → Safety → Try the risk engine** to see how it's scored,
without running anything.

## 7. Suggested first settings

| Setting | Where | Suggestion |
| --- | --- | --- |
| Start with Windows | Settings → General | On — while Nöbetçi is closed, questions fall back to the terminal. |
| Auto-allow ceiling | Settings → Safety | **LOW only** (the default). HIGH and CRITICAL are never approved automatically anyway. |
| Physical click guard | Settings → Safety | On (the default). Using a touchscreen or an accessibility tool? See [troubleshooting](#approval-refused-not-a-physical-click). |
| Rules | Settings → Rules | Start from the templates: allow `npm test`, block force push, keep it out of `.env` files. |
| Shortcuts | Settings → Notifications | Ctrl+Alt+N opens the island, Ctrl+Alt+D denies the request on the card. |
| Do not disturb | The button in the island's header, or the tray menu | During a presentation or a game. Full screen goes quiet by itself. |

## 8. Update

Download the new installer (check its fingerprint) and run it. Your settings, history and Claude
Code hooks are kept. Nöbetçi closes during the update; start it again when the installer is done.

## 9. Uninstall

Open **Settings → Apps → Installed apps** (**Apps & features** on Windows 10), find **Nobetci** and
choose **Uninstall**. The uninstaller:

1. removes **only Nöbetçi's own** entries from `~/.claude/settings.json`, after saving a dated
   backup — nothing else in the file changes;
2. removes the app, the relay and the log.

Your preferences (`%APPDATA%\Nobetci`) and history (`%LOCALAPPDATA%\Nobetci\audit.jsonl`) stay, so a
reinstall picks up where you left off. Delete those two folders to remove every trace.

## 10. Where things live

| What | Where |
| --- | --- |
| App | `%LOCALAPPDATA%\Nobetci\` |
| Relay | `%LOCALAPPDATA%\Nobetci\bin\nobetci-hook.exe` |
| Preferences | `%APPDATA%\Nobetci\settings.json` |
| History | `%LOCALAPPDATA%\Nobetci\audit.jsonl` (+ `audit.1.jsonl`) |
| Log | `%LOCALAPPDATA%\Nobetci\nobetci.log` |
| Claude Code hooks | `%USERPROFILE%\.claude\settings.json` (backups: `settings.json.bak-*`) |

The buttons on **Settings → About** show these files in File Explorer.

## 11. Troubleshooting

### The island doesn't show my sessions

- Run **Settings → Claude Code → Health check** and read the line marked ✗.
- **Did you restart the Claude Code session** after installing the hooks? Open sessions don't see
  new hooks.
- Is Claude Code running inside WSL? Its settings then live on the Linux side; Nöbetçi currently
  supports Claude Code on Windows only.
- If the hooks were removed later, Nöbetçi says so at start-up; reinstall them from
  **Settings → Claude Code**.

### Health check: the relay is missing

Quit and restart Nöbetçi; the relay is put back on every start. If your antivirus quarantined
`%LOCALAPPDATA%\Nobetci\bin\nobetci-hook.exe`, restore it and add an exclusion.

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

If you use one of them, switch off **Settings → Safety → Physical click guard**. If it refuses
ordinary mouse clicks, please open an issue — that would be a bug.

> If you see this warning **without having clicked**, a program on your machine tried to approve on
> your behalf. Deny the request and check what was running.

### Shortcuts don't work

**Settings → Notifications → Shortcuts** shows the state of each one. "Couldn't register" means another
app already uses those keys; pick a different combination.

### No sounds or notifications

Do not disturb, quiet hours or full-screen quiet may be on (the island's header says so). Windows **Focus /
Do not disturb** also hides Nöbetçi's notifications.

### The island is on the wrong screen or covers something

Change **Position** (left / centre / right) and **Display** (main display / display with the
pointer) in **Settings → General**.

### Windows Defender flags the installer

New unsigned programs can trip machine-learning false positives. Check the fingerprint against
`SHA256SUMS.txt` first. If it matches, open an issue — reporting the file to Microsoft as a false
positive helps too.

### I deleted Nöbetçi by hand and Claude Code reports a hook error on every step

The hooks point at a file that's gone. The easiest fix is to reinstall Nöbetçi and remove the hooks
with **Settings → Claude Code → Remove…**, or uninstall it the normal way. You can also restore one
of the `~/.claude/settings.json.bak-*` backups.

### More help

- Log file: `%LOCALAPPDATA%\Nobetci\nobetci.log`
- Bug reports: [Issues](https://github.com/tahap0l/nobetci/issues)
- Security vulnerabilities: please use [private reporting](https://github.com/tahap0l/nobetci/security/advisories/new)
  instead of a public issue ([SECURITY.md](../SECURITY.md))

## 12. Build from source

You need [Rust](https://rustup.rs) with the MSVC toolchain, Node.js 20+, and the
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
targets (`rustup target add aarch64-apple-darwin x86_64-apple-darwin`) and Node.js 20 or newer,
then `npm ci`, `npm test` and `npm run pack:mac` (→ `release/Nobetci-<version>-macos-universal.dmg`).

See [CONTRIBUTING.md](../CONTRIBUTING.md) for more.

## macOS

macOS support is new in 0.2.0 and still a beta. The setup wizard, connecting Claude Code, trying
it out, the suggested settings and most of the troubleshooting (sections 4–7 and 11) work the same
way on a Mac. This section covers what's different.

### Requirements

| | |
| --- | --- |
| macOS | 11 Big Sur or later, on Apple silicon or Intel (one universal app) |
| Claude Code | Running on the Mac itself: Terminal, iTerm2, VS Code, Cursor… |
| Rights | Nothing beyond dragging an app into Applications |

### Download and verify

1. From the [latest release](https://github.com/tahap0l/nobetci/releases/latest),
   download `Nobetci-x.y.z-macos-universal.dmg` and `SHA256SUMS.txt`.
2. Check the download in Terminal:

   ```sh
   cd ~/Downloads
   shasum -a 256 Nobetci-0.2.0-macos-universal.dmg
   grep macos SHA256SUMS.txt
   ```

   Both lines must show the same long value. If they differ, don't open the file — download it
   again.

### Install and open it the first time

1. Open the disk image, drag **Nobetci** into **Applications**, then eject the disk image.
2. Open **Nobetci** from Applications or Spotlight. Releases aren't notarized by Apple yet, so the
   first time macOS stops it:
   - **macOS 15 Sequoia and later:** a message says Apple could not verify that "Nobetci" is free
     of malware. Choose **Done**. Open **System Settings → Privacy & Security**, scroll down to
     *"Nobetci" was blocked to protect your Mac*, click **Open Anyway**, confirm with your
     password or Touch ID, and choose **Open Anyway** once more.
   - **macOS 14 and earlier:** Control-click **Nobetci** in Applications, choose **Open**, then
     **Open** again.

   You do this once, and again after each update.
3. **"Nobetci is damaged and can't be opened"?** That's the download's quarantine flag talking,
   not real damage. Once you've checked the SHA-256, clear the flag in Terminal and open it again:

   ```sh
   xattr -dr com.apple.quarantine /Applications/Nobetci.app
   ```

   (When an agent asks to run this, Nöbetçi scores it HIGH — here it's you, for an app you've
   just verified.)
4. Allow notifications when macOS asks. You can change it later in **System Settings →
   Notifications → Nobetci**.

The owl says hello just below the menu bar, and the setup wizard opens — carry on with
[section 4](#4-first-run-and-the-setup-wizard).

### What's different on a Mac

- **A menu bar app.** No Dock icon and not in ⌘-Tab; Nöbetçi's menu sits in the menu bar.
- **The island sits below the menu bar.** On a MacBook with a notch nothing hides behind the
  camera housing.
- **Shortcuts.** Ctrl is ⌃ Control and Alt is ⌥ Option, so the defaults are ⌃⌥N (open the
  island) and ⌃⌥D (deny). Your own shortcuts may use ⌘ too.
- **Go to window** brings the session's app (Terminal, iTerm2, VS Code…) to the front, not one
  particular window or tab.
- **Clicking the island makes Nöbetçi the active app**, so your terminal loses keyboard focus
  until you switch back (⌘-Tab, or **Go to window**). On Windows the island never takes focus;
  doing the same on a Mac is on the list.
- **Quiet in full screen** isn't available yet. Do not disturb and quiet hours work.
- **The click guard** checks that an approval click came from a real mouse or trackpad: macOS
  marks every mouse event with who made it. A program can only fake clicks if you've given it
  Accessibility access (**System Settings → Privacy & Security → Accessibility**), so keep that
  list short.
- **Start at login** adds a LaunchAgent for Nöbetçi.

### Update

Download the new disk image and check it, quit Nöbetçi from the menu bar, drag the new
**Nobetci** into Applications and choose **Replace**. You may have to confirm **Open Anyway** once
more. Your settings, history and Claude Code hooks stay.

### Uninstall

1. **Settings → Claude Code → Remove…** takes Nöbetçi's entries out of `~/.claude/settings.json`,
   with a diff and a dated backup as always.
2. If **Start at login** is on, switch it off in **Settings → General**.
3. Quit Nöbetçi from the menu bar and move **Nobetci** from Applications to the Bin.
4. To remove every trace, also delete `~/Library/Application Support/Nobetci`.

Forgot step 1? Nothing breaks: the relay stays in that folder, finds nobody listening and exits,
and Claude Code carries on. You can also run
`/Applications/Nobetci.app/Contents/MacOS/nobetci --remove-hooks` before deleting the app.

### Where things live

| What | Where |
| --- | --- |
| App | `/Applications/Nobetci.app` |
| Preferences | `~/Library/Application Support/Nobetci/settings.json` |
| History | `~/Library/Application Support/Nobetci/audit.jsonl` (+ `audit.1.jsonl`) |
| Log | `~/Library/Application Support/Nobetci/nobetci.log` |
| Relay | `~/Library/Application Support/Nobetci/bin/nobetci-hook` |
| Relay socket | `~/Library/Application Support/Nobetci/nobetci.sock` |
| Claude Code hooks | `~/.claude/settings.json` (backups: `settings.json.bak-*`) |

Finder hides `~/Library`: choose **Go → Go to Folder…** (⇧⌘G) and paste the path, or use the
buttons on **Settings → About**.

### Troubleshooting on a Mac

- **The island doesn't show my sessions.** Run the health check and restart Claude Code, as in
  [section 11](#11-troubleshooting).
- **Approval refused: not a physical click.** Screen Sharing and other remote-control tools,
  Universal Control (another Mac's keyboard and mouse) and accessibility tools such as Voice
  Control or Switch Control send clicks that macOS marks as coming from a program. Use the Mac's
  own mouse or trackpad, or switch off **Settings → Safety → Physical click guard**. If an
  ordinary trackpad click is refused, please open an issue — the macOS guard is new.
- **No notifications.** Allow them in **System Settings → Notifications → Nobetci**; a Focus mode
  can hide them too.
- **Shortcuts don't work.** **Settings → Notifications → Shortcuts** shows whether another app
  already owns a combination.
- **The island is on the wrong display.** Change **Display** in **Settings → General**.
