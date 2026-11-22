<div align="center">

<p align="center"><img src="docs/media/en/idle-island.png" width="720" alt="The expanded island with the wolf mascot: five card tabs (Media, Agenda, Calendar, Weather and System), a playing track and the focus timer above the session list"></p>


<img src="src-tauri/icons/128x128@2x.png" width="96" height="96" alt="Nöbetçi's owl">

# Nöbetçi

**A watchful owl for Claude Code, Codex and Cursor.**

[![CI](https://github.com/tahap0l/nobetci/actions/workflows/ci.yml/badge.svg)](https://github.com/tahap0l/nobetci/actions/workflows/ci.yml)
![Windows 10 | 11](https://img.shields.io/badge/Windows-10%20%7C%2011-0078D4)
![macOS 11+](https://img.shields.io/badge/macOS-11%2B-555555)
![Linux](https://img.shields.io/badge/Linux-x86__64-555555)
![Tauri 2](https://img.shields.io/badge/Tauri-2-24C8DB)
[![License: MIT](https://img.shields.io/badge/license-MIT-2EA043)](LICENSE)

**English** · [Türkçe](README.tr.md)

</div>

## Download and use

**[Latest Windows, macOS and Linux installers](https://github.com/tahap0l/nobetci/releases/latest)**

[Website](https://tahap0l.github.io/nobetci/) · [Interactive web demo](https://tahap0l.github.io/nobetci/demo/)

Nöbetçi sits at the top of the screen. Click the compact island to open your agent sessions and cards. Permission requests open the approval card first.

- **Agent monitoring.** Track Claude Code, Codex, and Cursor sessions and supported permission requests. On Windows, you can also see ChatGPT response status from Chrome or Edge (the bridge registers on Windows only). [ChatGPT Web setup](integrations/chatgpt-web/README.md)
- **Five island tabs.** **Media** (with the focus timer), **Agenda**, **Calendar**, **Weather** and **System**: click a tab, or scroll or swipe through the cards. Browse weeks with the calendar arrows and see the selected city's conditions and temperature in a table.
- **Media and focus.** The player shows what is playing, with the artwork blurred behind the card, a live time bar you can click to seek, and play, pause, next and previous. It follows the system media controls on Windows (Spotify, browsers…), Spotify and Music on macOS, and every MPRIS player on Linux (Spotify, VLC, browsers…). The 25-minute focus timer can be paused or reset. Choose a weather city and enable media under **Settings → General → Island widgets**.
- **An assistant on the island.** Press `Ctrl+Alt+Space` (or the ✦ button), write what you want and send it to ChatGPT, Claude, Gemini, Perplexity, Copilot, Grok, DeepSeek or Mistral — the app or website opens with your message, and it is on the clipboard too. On the web, ChatGPT, Claude, Perplexity, Copilot and Grok get the message in the page address, so it reaches them as soon as the page opens and some may answer right away; elsewhere you press send. **Here** answers on the island itself with your Prompt Studio model. Slash commands control Nöbetçi from the same box: `/pause`, `/dnd`, `/focus 25`, `/play`, `/next`, `/prev`, `/settings`; ↑ and ↓ bring back earlier messages. Esc, ✕ or the shortcut close it again.
- **Voice and ready-made prompts.** The 🎙 button starts your system's dictation (Windows voice typing, macOS Dictation; Linux has none, so there is no button there); **Prompt ideas** gives beginners about twenty fill-in-the-blanks prompts. If the Claude, ChatGPT, Perplexity or Copilot app is installed, the message opens there instead of the browser.
- **Agenda, calendar, weather and system.** Note what to do on a day, with an optional reminder time; see busy days on the calendar; an animated forecast for the next twelve hours; and live CPU, RAM and GPU load.

<p align="center">
  <img src="docs/media/en/card-agenda.png" width="49%" alt="The Agenda tab: today's notes with their times, one ticked off, and a row to add a new one">
  <img src="docs/media/en/card-calendar.png" width="49%" alt="The Calendar tab: one week as day pills, with dots on a busy day">
  <img src="docs/media/en/card-weather.png" width="49%" alt="The Weather tab: the city's temperature, conditions, feels-like and wind, and the next twelve hours">
  <img src="docs/media/en/card-system.png" width="49%" alt="The System tab: processor, memory and graphics load as rings, and a minute of processor history">
</p>

- **Claude Code everywhere.** Sessions from the terminal, VS Code and the **Code tab of the Claude desktop app** all show on the island; the card tells you where each one runs. The desktop app never runs Claude Code's `PermissionRequest` hook, so there Nöbetçi asks from `PreToolUse` for commands, edits, web fetches and MCP tools — see [Never holds Claude Code hostage](#never-holds-claude-code-hostage) for what that costs when nobody is at the screen.
- **Questions and plans on the island.** When Claude asks a multiple-choice question or wants its plan approved, the card shows it: pick an answer (or write your own), approve the plan or send it back with a note.
- **What changed, and how much is left.** The session view lists the files each session edited, with lines added and removed and the diff a click away. With the opt-in status line, it also shows context use, cost, and your 5-hour and weekly plan limits.
- **Seven mascots.** The owl, a wolf, a hawk, an octopus, a lion, a canary and an eagle move and react the same way: they wave at a permission request, bristle at a risky one, hop when a session finishes and doze when nothing is running. Choose one under **Settings → General → Appearance**; it also sets the card colors and transitions. Try the reactions in the web demo.

<p align="center"><img src="docs/media/en/mascots.png" width="720" alt="The seven mascots side by side, each in a different mood: the owl idle, the wolf waving at a permission request, the hawk alarmed, the octopus thinking, the lion happy, the canary delighted and the eagle puzzled"></p>

- **A mascot on your desktop.** Drag the mascot anywhere on the screen with the mouse; it stays where you leave it, spreads its wings while you carry it and lands with a bounce. It shares the island's mood, pokes back when clicked and opens the island on a double click. Turn it on or off under **Settings → General → Desktop mascot** or from the tray menu. It only shows: decisions are still made on the island's card.
- **Every decision shows on its face.** Approve, and the mascot beams, nods twice, hops with its wings up and a green tick draws itself in a burst of sparkles. Deny, and it frowns, pins its ears back, shakes its head and huffs while a red cross pops up.

<p align="center"><img src="docs/media/en/reactions.png" width="720" alt="Six mascots reacting to decisions: the owl, wolf and canary beaming under a green tick after an approval; the owl, lion and hawk frowning under a red cross after a denial"></p>

Nöbetçi is a small owl on a black island at the top of your screen. It watches Claude Code, Codex
and Cursor sessions, records submitted prompts and surfaces supported permission requests. Claude
Code has the full safety review; Codex and Cursor support depends on each agent's hook API.
Permission cards show what would run, how risky it looks and why, so you can decide without hunting
for the right terminal. 

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
- **Session detail.** A timeline of recent steps, active subagents, counters (tools, approvals, denials, automatic
  decisions) and **Go to window**, which brings the session's terminal or editor to the front.
- **Opens when it matters.** A permission request, an error or a question from Claude opens the
  island; a finished session can too, if you like. Otherwise it stays out of the way.
- **Desktop notifications** when the island isn't open (the compact pill counts as out of sight),
  synthesised sounds, and an owl whose mood follows the work — and who dozes off after three calm
  minutes, when the island stops drawing altogether.

### ✋ Decide

- **Risk-scored approval cards.** Every request is rated LOW, MEDIUM, HIGH or CRITICAL, with the
  reasons listed and the risky part of the command highlighted.
- **What you see is what runs.** The card shows the whole command, file path, URL or MCP arguments.
  Invisible and direction-changing Unicode characters appear as markers like `⟦U+202E⟧`, long runs
  of blank lines or spaces are collapsed into markers like `⟦40 blank lines⟧`, and a request too
  long to carry whole is flagged and scored HIGH — never silently cut.
- **Press and hold for the dangerous ones.** HIGH and CRITICAL requests need the Allow button held
  down (1.2 s and 2.4 s by default). The rule is enforced in Rust, not just in the UI.
- **No approval by accident.** A card that has just appeared ignores clicks for a moment, so a
  double-click, or the release of a hold, meant for one card can't approve the next one.
- **Deny with a reason.** Claude reads your reason and carries on another way; **Deny and stop
  Claude** also ends its turn. **Hand to terminal** gives the decision back to Claude Code's own
  prompt.
- **Many small ones at once.** When two or more LOW requests wait, a row lists them, and its **Allow all** button clears exactly those with one real click. Anything above LOW, and anything the risk engine itself scored above LOW before a rule lowered it, keeps its own card.
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
  you, a hotkey, a batch, a rule, a trusted project, a session grant, a timeout or the terminal.
  Search, filters, charts, CSV and JSON export.
- **Quiet when you need it.** Do not disturb, quiet hours, and automatic quiet while a full-screen
  app is in front. Requests still queue; nothing pops up or makes a sound.
- **Prompt Studio for any agent.** Choose Claude Code, Codex, Cursor, ChatGPT, Gemini or another
  target; fix spelling and clarify the request with local Ollama by default, or explicitly choose
  the OpenAI API. Review and copy the result yourself — it is never sent to an agent automatically.
- **And the rest.** Global hotkeys, a hook health check through the real relay, a choice of which
  hook events to listen to, per-category risk switches, island placement, settings import and
  export, and an English or Turkish UI that follows your system language.

### 🔒 Privacy

- **No telemetry or accounts.** Outside an explicit prompt review, an assistant question you send
  with **Here**, and the weather card once you pick a city, Nöbetçi makes no network requests.
  Sending a message to an AI app opens that app or your browser; Nöbetçi itself sends nothing — but
  for ChatGPT, Claude, Perplexity, Copilot and Grok on the web the message is in the page address,
  so the service gets it as the page opens and your browser history keeps it. Ollama uses its local
  service by default; Ollama models marked **cloud** may forward the draft. OpenAI receives it only
  after you select it and click **Improve**. Optional API keys stay in the operating system
  credential vault.
- **Local data.** Settings, history and log are JSON, JSON Lines and text. Drafts and rewrites are
  not saved to history.
- **Secrets stay out of the record.** API keys, tokens, passwords and private keys are masked
  before a request is written to the history or shown in a notification. The approval
  card itself always shows the request in full.

See the full [Privacy Policy](PRIVACY.md).

### Code signing policy

Free code signing provided by [SignPath.io](https://signpath.io), certificate by
[SignPath Foundation](https://signpath.org). No release has been code-signed so far, v2.4.1
included: Windows releases move to signed builds once the application is accepted and signing is
switched on, and each release's notes say whether its files are signed. Until then, check every
download against `SHA256SUMS.txt`. What is signed, how a release is approved and who approves it:
[Code signing policy](CODE_SIGNING_POLICY.md).

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
Windows, a Unix socket in your Library folder on macOS and in `~/.local/state/nobetci` on Linux —
and exits. Only a permission request waits for an answer: the risk engine scores it, your rules
get the first word, and a rule, a trusted project or a session grant can settle it on the spot.
Everything else becomes a card on the island, and your decision travels back the same way. Codex
and Cursor use the same relay through their own hooks.

### Never holds Claude Code hostage

| Situation | What happens |
| --- | --- |
| Nöbetçi isn't running | The relay finds nobody listening, exits at once with no output, and Claude Code asks in the terminal as usual. On Windows, a pipe that exists but is busy gets at most **300 ms**. |
| The island can't show the card | The app gives the island **800 ms** to confirm that the card is on screen or queued. No confirmation: back to the terminal. |
| Nobody answers | The app lets go after **108 s** and the relay after **110 s** (the hook itself is registered with a 120 s timeout). Claude Code then asks in the terminal. |
| Paused, or six requests already waiting | New requests go straight to the terminal. |
| Any other hook event | Fire and forget: connect, write, exit, within a hard 2 s budget. |
| Cursor, and Nöbetçi gives no answer | Closed, paused, handed back, queue full or timed out: the relay answers "ask", and Cursor asks you itself. Nöbetçi's Cursor permission hooks are fail-closed, though: if the relay itself can't run (for example after its folder was deleted), Cursor blocks shell and MCP commands until the hooks are removed. |
| The Claude desktop app | It never runs the `PermissionRequest` hook, so Nöbetçi asks from `PreToolUse`, which fires before the app's own check. Every command, edit, web fetch and MCP call that could ask waits for the island, **including ones your Claude permission rules already allow**. Nobody answering means up to **108 s** before the app's own behaviour takes over. Before leaving a desktop-app session to run unattended, pause Nöbetçi from the tray (requests then pass straight back), or let LOW requests through with a trusted project or rules. |

## Install

> 📖 The [installation guide](docs/install.md) goes through every step in detail, plus updating,
> uninstalling and troubleshooting.

Nöbetçi runs on **Windows 10 and 11** (64-bit), on **macOS 11 or later** (Apple silicon and
Intel) and on **Linux** (x86-64, X11 or Wayland). It needs [Claude Code](https://code.claude.com/docs/en/overview)
running on the same system — Claude Code inside WSL or a container keeps its settings elsewhere
and isn't covered.

Below, `x.y.z` stands for the version you download. Releases after 2.4.1 also carry each file
without the version in its name (`Nobetci-setup.exe`, `Nobetci-macos-universal.dmg`,
`Nobetci-linux-amd64.deb`, `Nobetci-linux-amd64.AppImage`), listed in `SHA256SUMS.txt` too.

### Windows

The Microsoft Edge WebView2 runtime is part of Windows 11 and current Windows 10; the installer
fetches it if it's missing.

1. Download `Nobetci-x.y.z-setup.exe` and `SHA256SUMS.txt` from the
   [latest release](https://github.com/tahap0l/nobetci/releases/latest).
2. Check that the installer is the one that was published:

   ```powershell
   Get-FileHash .\Nobetci*setup.exe -Algorithm SHA256
   Get-Content .\SHA256SUMS.txt
   ```

   The two hashes must be identical (upper or lower case doesn't matter).
3. Run the installer. It installs for your Windows account only, into `%LOCALAPPDATA%\Nobetci`,
   and needs no administrator rights. It speaks Turkish on a Turkish Windows and English
   everywhere else. Add `/S` for a silent install.

> [!NOTE]
> **"Windows protected your PC"?** Releases aren't code-signed yet, so a new installer has no
> SmartScreen reputation. Once you've checked the hash, choose **More info → Run anyway**. Signed
> releases are on the [roadmap](#roadmap).

### macOS

1. Download `Nobetci-x.y.z-macos-universal.dmg` and `SHA256SUMS.txt` from the
   [latest release](https://github.com/tahap0l/nobetci/releases/latest).
2. Check the disk image in Terminal:

   ```sh
   shasum -a 256 ~/Downloads/Nobetci-x.y.z-macos-universal.dmg
   cat ~/Downloads/SHA256SUMS.txt
   ```

3. Open the disk image and drag the owl into **Applications**. (Finder may call it Nöbetçi or
   Nobetci; on disk it is always `/Applications/Nobetci.app`.)
4. Open it from Applications. The app isn't notarized by Apple yet, so the first time macOS
   refuses: choose **Done**, then go to **System Settings → Privacy & Security**, scroll to the
   line saying the app was blocked and click **Open Anyway**. (On macOS 14 and earlier,
   Control-click the app → **Open** → **Open** works too.)

Nöbetçi lives in the menu bar, with no Dock icon. The [installation guide](docs/install.md#macos)
has the details.

### Linux

Nöbetçi runs on X11 and, through XWayland, on Wayland desktops (GNOME, KDE Plasma, Xfce,
Cinnamon…). It needs WebKitGTK 4.1, which current Ubuntu, Debian, Fedora and Arch ship, and — on
X11 — a compositing window manager, because the island is a transparent window. GNOME, KDE Plasma
and Cinnamon composite by themselves; on Xfce turn on **Window Manager Tweaks → Compositor**, and
on a bare window manager run a compositor such as `picom`. Without one the island can show up as a
black box at the top of the screen.

1. Download `Nobetci-x.y.z-linux-amd64.deb` (Debian, Ubuntu, Mint…) or
   `Nobetci-x.y.z-linux-amd64.AppImage` (any distribution) and `SHA256SUMS.txt` from the
   [latest release](https://github.com/tahap0l/nobetci/releases/latest).
2. Check the download (each file you downloaded must say `OK`):

   ```sh
   sha256sum --check --ignore-missing SHA256SUMS.txt
   ```

3. Install the package with `sudo apt install ./Nobetci-x.y.z-linux-amd64.deb`, or make the
   AppImage executable (`chmod +x Nobetci-*.AppImage`) and run it.

Nöbetçi lives in the system tray. On GNOME the tray needs the *AppIndicator* extension (Ubuntu has
it already). The relay's socket is `~/.local/state/nobetci/nobetci.sock`, settings are in
`~/.config/nobetci`, the history in `~/.local/share/nobetci`.

On a **Wayland** session (the default on current Ubuntu, Fedora and KDE Plasma) Nöbetçi's window
runs on XWayland, and three things only see X11 windows: global shortcuts work only while an X11
window has the focus, **Go to window** can't find terminals that run natively on Wayland (it opens
the session's folder instead), and quiet in full screen doesn't notice native Wayland apps. The
[installation guide](docs/install.md#linux) has the details.

### Build from source

You need [Rust](https://rustup.rs) with the MSVC toolchain, Node.js 22 or newer, and the
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
targets (`rustup target add aarch64-apple-darwin x86_64-apple-darwin`) and Node.js 22 or newer;
`npm run pack:mac` builds `release/Nobetci-<version>-macos-universal.dmg`.

On Linux you need Rust, Node.js 22 or newer and the WebKitGTK development packages
(`sudo apt install libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev libxi-dev libxdo-dev libdbus-1-dev libssl-dev`
on Debian and Ubuntu); `npm run pack:linux` builds the `.deb` and the AppImage. The AppImage
carries the GStreamer plugins installed on the build machine, so install
`gstreamer1.0-plugins-base gstreamer1.0-plugins-good gstreamer1.0-pulseaudio gstreamer1.0-alsa`
and `patchelf` first, or its sounds won't play.

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
  <img src="docs/media/en/wizard.png" width="720" alt="The welcome wizard that opens on first launch: five steps (Welcome, Connect, Health check, Safety, Done) and the language choice">
</p>

Then press **Health check** in **Settings → Claude Code**: it runs the relay exactly the way
Claude Code would and times a ping through it. Claude Code reads hooks when a session
starts, so restart any session that was already running.

Open **Settings → ChatGPT** to connect local ChatGPT Work and Codex, or **Settings → Other agents**
for Cursor. Choose **Connect…**, review the settings-file diff and confirm. In ChatGPT desktop, review and trust
the Nöbetçi hooks in **Settings → Hooks**. If the list is empty, add a local project in the
Codex view and refresh it. In the Codex CLI, use `/hooks`. **Health check**
shows the relay test and the last event received from Codex separately. If Windows reports
outdated entries, choose **Update connection…** and review the changed hooks in ChatGPT or
Codex. Send a message in a new local chat and rerun **Health check** to verify delivery. Work Cloud
does not run local hooks.
Local Work and Codex prompt submissions and supported permission requests use the same hooks.
Cursor prompt submissions and shell/MCP requests are tracked. When Nöbetçi gives no answer for a
Cursor request (it is closed or paused, you handed the request back, or it timed out), Cursor asks
you itself; only a relay that can't run at all makes Cursor block the command, because its
permission hooks are fail-closed. Prompt text is shown in the timeline, but the agent hooks cannot
rewrite it before the agent receives it.

## Using it

### The island

<p align="center">
  <img src="docs/media/en/overview.png" width="720" alt="The expanded island: the card tabs, the media card and the focus timer above three Claude Code sessions, each with its state and last step">
</p>

- **Hidden** — a thin, invisible strip along the top edge. Move the mouse there to wake it.
- **Compact** — a small black pill with one line of status ("2/3 working", "Needs approval —
  click") and a mini owl for each session. Click it to open.
- **Expanded** — your sessions, a session's detail, the assistant, or the approval card. It folds
  back 15 s after the mouse leaves (adjustable), but never while a request is waiting.

<p align="center">
  <img src="docs/media/en/session.png" width="49%" alt="Session detail: context and plan-limit meters, the changed files with lines added and removed, and a timeline of recent steps, under Go to window and Folder buttons">
  <img src="docs/media/en/assistant.png" width="49%" alt="The island's assistant: ready-made prompt ideas above a text box, and the AI apps it can send to">
</p>

Click a session's row for its detail: a timeline of recent steps, the files it changed with their
diffs, counters, and **Go to window**. The assistant opens with `Ctrl+Alt+Space` or the ✦ button;
Esc, ✕ or the shortcut close it again.

The tray icon (the menu bar icon on a Mac) has **Open Nöbetçi**, **Settings…**, **Pause / resume**,
**Do not disturb on / off**, **Desktop mascot on / off** and **Quit**. Pausing hands every waiting request
back to the terminal and notes it on the session's timeline. A hidden island costs next to nothing:
the animation loop stops and the cursor poll parks.

### The approval card

<p align="center">
  <img src="docs/media/en/low.png" width="720" alt="An approval card for a LOW-risk npm test command with an Allow button and the option not to ask again in this session">
</p>

- **The header** shows the risk level, the session and tool (for an MCP tool, its server too),
  your place in the queue and a countdown to when the terminal takes over. With more than one
  request waiting, the arrows next to the count let you look at the others without answering.
- **The request** is shown in full — the command, the file path with the content that would be
  written (every edit of a multi-edit), the URL or the MCP arguments — with the parts behind each
  finding highlighted. If the box has to scroll, it says so. A request that was too long to carry
  whole is marked as cut, and scored HIGH.
- **The findings** list every reason with its level, plus any rule or project note ("Strict
  project", or a rule that wanted to allow the request but hit the ceiling).
- **Allow** is a click for LOW and MEDIUM. For HIGH and CRITICAL it reads **Hold · Allow**: keep
  it pressed until the bar fills. Approvals take a real mouse click, not Enter or Space.
- **Deny** refuses the request and tells Claude, which carries on another way. The arrow next to
  it opens ready-made reasons that are passed on to Claude (edit them in Settings → Rules) and
  **Deny and stop Claude**, which also ends Claude's turn so it waits for you.
- **Don't ask again this session for …** is offered only where the auto-allow ceiling allows it:
  LOW with the default ceiling, LOW and MEDIUM with *LOW + MEDIUM*, never with the ceiling off. The
  box says what it covers — this exact command, changes to this file, this address, or this tool
  with the same arguments — in that session, until Nöbetçi restarts. Each later request is still
  scored, and anything above the ceiling comes back to you.
- **Hand to terminal** lets Claude Code ask in the terminal instead.

### Questions, plans and batches

<p align="center">
  <img src="docs/media/en/question.png" width="49%" alt="A question card: two of Claude's questions with their options, a box for your own answer under each, and Send answer">
  <img src="docs/media/en/plan.png" width="49%" alt="A plan card: Claude's plan as formatted text, a note box, Send back with note and Approve plan">
</p>

- **Questions.** When Claude asks a multiple-choice question, pick one or more options or write
  your own answer, and send it. Only you answer these; no rule does.
- **Plans.** When Claude finishes a plan, read it on the card and **Approve plan**, or write what
  to change and **Send back with note**: Claude reads the note and keeps planning. Turn both off
  under **Settings → Claude Code → Questions and plans**.
- **Batches.** With two or more LOW requests waiting, a row lists them and offers **Allow all**:
  one real click allows exactly the requests it lists. Questions, plans and anything above LOW are
  never part of it. The history marks what it allowed as **Batch (low risk)**.

<p align="center">
  <img src="docs/media/en/batch.png" width="49%" alt="A LOW approval card, and below it a row listing three waiting low-risk requests with an Allow all 3 button">
</p>

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

- **CRITICAL** — running code straight from the internet (`curl … | sh`, `bash -c "$(curl …)"`,
  `bash <(curl …)`, `iex (irm …)`); encoded or base64-obfuscated commands; switching off Defender
  or the firewall, deleting shadow copies or event logs, `bcdedit`; on macOS, switching off
  Gatekeeper (`spctl --master-disable`), SIP, the application firewall or quarantine, resetting
  privacy permissions (`tccutil reset`) or erasing the unified log; formatting or overwriting a
  disk (including `diskutil erase…`); deleting the home folder, a drive or the root; deleting a
  GitHub repository or making it public; changing Claude Code's permission or hook settings, or
  Codex's and Cursor's hook settings; changing Nöbetçi's own files, programs or relay — on
  Windows, macOS and Linux, whichever command does the writing; removing Nöbetçi's hooks
  (`nobetci --remove-hooks`); touching SSH `authorized_keys`.
- **HIGH** — trying to stop or uninstall Nöbetçi; recursive deletes; force pushes, git commands
  that throw away uncommitted work (`git restore .`, `git checkout -f`, `git clean --force`) and
  other irreversible git operations; publishing packages or releases; `sudo`, `doas`, `pkexec`,
  `su`, `runas`, `gsudo` and AppleScript's `with administrator privileges`; persistence (scheduled
  tasks, Run keys, services, startup folders, cron and `crontab`, systemd units including user
  ones, LaunchAgents and LaunchDaemons, login items); removing the macOS quarantine flag (`xattr -d`);
  reading the macOS keychain (`security find-generic-password`, `dump-keychain`); suspicious
  built-in Windows tools such as `mshta`,
  `regsvr32 /i:`, `certutil -urlcache` or `bitsadmin /transfer`; bypassing the PowerShell
  execution policy; credential and secret files; known exfiltration services (paste sites,
  request catchers, tunnels, chat webhooks); overly broad permissions (`chmod 777`,
  `icacls … Everyone:F`, `takeown`); shutting down or rebooting; destructive database commands;
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

A command is read as a command, not searched for words: `git commit -m "graceful shutdown"`,
`npm publish --dry-run`, `cat .env.example` and `curl … | python3 -m json.tool` (a download read
as data, not run) stay LOW. A command that writes a file — a redirect, `tee`, `cp`, `curl -o`,
`sed -i`, a one-liner — is judged like a file write to that path.

**File writes** — paths are resolved against the session's folder first, so `.claude//settings.json`,
`./.git/hooks/pre-commit` or `../../usr/local/bin/git` meet the same rules as the plain spelling.
CRITICAL for Claude Code's settings files, Codex's and Cursor's hook files, Nöbetçi's own files
and anything under `~/.ssh`; HIGH for
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

**MCP tools** — read by the words of the tool's name (after the server's): HIGH when it says
delete, remove, trash, destroy, drop, purge, wipe, terminate, revoke and the like; MEDIUM when it
sends, posts, publishes, pushes, creates, updates, uploads, pays, deploys, migrates or runs
something; LOW otherwise. Its arguments are checked too: a command, a URL, a file path or SQL
(`DROP TABLE` in an `execute_sql` call is HIGH). A tool Nöbetçi doesn't know is shown and matched
with all of its arguments.

**Combinations** — a secret and a way out in the same request is CRITICAL, and a request that had
to be cut to fit is HIGH. These two can't be switched off, not even by switching off the
categories that make them up; every other category can, in **Settings → Safety → Risk
categories**. The same page has a tester that scores a request for any tool the way the engine
would.

</details>

### Rules, project trust and the ceiling

<p align="center">
  <img src="docs/media/en/settings-rules.png" width="720" alt="The Rules page in Settings: numbered rules, each with its tool, pattern and action, above the start of the project trust section">
</p>

Rules are checked from top to bottom before a card is shown, and the first match wins.

| A rule can… | How it behaves |
| --- | --- |
| **Allow** | Only up to the auto-allow ceiling. A riskier match still comes to you, with a note saying which rule wanted to allow it. |
| **Deny** | At any level. The request never reaches you; Claude gets your message and carries on another way. |
| **Always ask** | Even where a trusted project or a session grant would have let it through. |
| **Re-score** | Set the level from LOW to CRITICAL — useful for a false alarm. A CRITICAL finding never drops below HIGH, so it still needs a hold. A request the engine itself scored HIGH or CRITICAL is never approved automatically, even after a rule lowers it: it becomes a plain click, not a silent pass. |

How patterns match:

- **Starts with** ends at a word boundary: `npm test` matches `npm test -- --watch`, not
  `npm testing`.
- **Glob** (`*` and `?`) crosses line breaks, so a newline in a command can't slip past a deny
  rule. The editor checks glob and regex patterns with the same engine the rules use, and shows
  where one fails.
- **A loose rule that allows or lowers covers one command only.** With *starts with*, *contains*,
  a glob or an empty pattern, an allow rule (or one that lowers the level) doesn't match when the
  command chains more commands than the pattern itself does: a line break, `;`, `&&`, `||`, `|`,
  `&`, backticks or `$(`. *Equals* and regex patterns mean exactly what they say, and deny,
  always-ask and raising rules match anywhere.
- **An empty pattern matches everything** for its tool (the "ask every time for MCP tools"
  template relies on it); the editor warns you before you save one for every tool.

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
  <img src="docs/media/en/settings-history.png" width="720" alt="The History page in Settings: the recording switch and file size, totals for the last 30 days, and the start of the daily decisions chart">
</p>

Every permission request is recorded: when, the project and tool, the target (up to 4,000
characters, secrets masked), the risk and findings, the decision, who made it and how long it
took — including requests that timed out, went to the terminal, or whose answer never reached
Claude Code. Search it, filter it, look at daily charts and the most frequent projects, findings
and tools, and export everything that matches as CSV or JSON. The CSV uses a comma, or a
semicolon for spreadsheets in languages that expect one (Turkish Excel, for example), and is safe
to open: cells that would be read as formulas are defused.

The history lives in `audit.jsonl` in Nöbetçi's data folder (see [Development](#development)),
rolls over to `audit.1.jsonl` at 10 MB (adjustable), and can be switched off or cleared in
**Settings → History**. A damaged line is skipped, never the whole file, and on macOS and Linux
only your account can read it.

### Hotkeys

| Action | Default |
| --- | --- |
| Open or fold the island | `Ctrl+Alt+N` |
| Deny the request on the card | `Ctrl+Alt+D` |
| Allow the request on the card | Not set — LOW-risk requests only |
| Do not disturb on / off | Not set |
| Open the assistant | `Ctrl+Alt+Space` |

On a Mac, Ctrl is ⌃ Control and Alt is ⌥ Option. Hotkeys work from any window (on a Linux Wayland
session, only while an X11 window has the focus). Any program can fake keystrokes, so the allow
hotkey is off by default and — enforced in Rust — never approves anything the risk engine itself
scored above LOW, whatever a rule made of it. Change them in **Settings → Notifications**. On
Windows and Linux a letter is the one your keyboard layout prints on the key; macOS ties a
shortcut to the key's position, so there letters are named as on a US keyboard.

### Quiet

**Do not disturb** (the moon button on the island, the tray menu or a hotkey), **quiet hours**
(for example 23:00–08:00) and **quiet in full screen** (on by default, for games, presentations
and full-screen video). While it's quiet there are no sounds and no notifications, and the island
doesn't pop open — but requests still queue, and the compact island tells you one is waiting.
Quiet hours with the same start and end time mean no quiet hours at all; for a whole quiet day,
use Do not disturb.

## Security model

Nöbetçi is a second pair of eyes, not a sandbox. The risk engine is a set of heuristics: it
catches the obvious and the classic, a determined attacker can get past it, and LOW means
"nothing obvious", never "safe". What it adds is visibility, friction for dangerous actions, and
reasons you can read.

<p align="center">
  <img src="docs/media/en/settings-security.png" width="720" alt="The Safety page in Settings: the auto-allow ceiling with what each risk level needs (HIGH and CRITICAL always need you and a hold), and the risk-engine tester">
</p>

What it takes care of: the card shows exactly what will run; HIGH and CRITICAL approvals need a
hold that Rust enforces; approvals must come from a physical mouse click on the Allow button
itself — one click, one approval, never on a card that has only just appeared — so a script
can't press Allow on the agent's behalf; the relay and the app talk over a named pipe (Windows)
or a Unix socket (macOS, Linux) that only your account can open, and the relay checks that the
app on the other end runs as you; a request to change Nöbetçi's own files, swap its relay or
remove its hooks is CRITICAL on every system; the history masks secrets, and its CSV export is
formula-safe.

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
Nöbetçi has no telemetry, crash reports, update checks or accounts. In **Settings → Prompt Studio**,
Ollama requests go to its local service by default; Ollama models marked **cloud** may forward them.
If you select OpenAI and click **Improve**, the current draft is sent to the OpenAI API. Nöbetçi
never forwards it to the selected agent or saves it to history. The assistant's **Here** uses the
same provider, and the weather card asks Open-Meteo for the city you pick. The
[privacy policy](PRIVACY.md) lists everything.

**What happens if Nöbetçi is closed, paused or crashes?**
Claude Code and Codex carry on as if Nöbetçi weren't installed: with nobody listening (or the
island paused), the relay exits without output and they ask in the terminal. Cursor asks you
itself. The one case that blocks is a Cursor hook whose relay can't run at all — see
[Uninstall](#uninstall).

**What happens when I uninstall it?**
On Windows the uninstaller runs `nobetci.exe --remove-hooks`, which removes Nöbetçi's own entries
from `~/.claude/settings.json` and from Codex's and Cursor's `hooks.json` — each with a dated
backup next to it — and touches nothing else. On a Mac and on Linux there is no uninstaller that
can do it for you, so run the same command (or remove the connections in Settings) before you
delete the app. See [Uninstall](#uninstall).

**Does it run on macOS? Linux?**
Both, yes. On macOS 11 or later the island sits below the menu bar as a panel that never steals
focus, quiet in full screen works, and **Go to window** brings the session's app to the front
rather than one particular window. On Linux the island runs on X11 (with a compositor) or,
through XWayland, on Wayland, where global shortcuts, **Go to window** and quiet in full screen
only see X11 windows; the media card works with every MPRIS player.

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
runs with your rights and could, for instance, edit Claude Code's settings, rewrite Nöbetçi's
own settings or remove its hooks — which is exactly why such requests are scored CRITICAL. The
[threat model](SECURITY.md) has the details.

**In the Claude desktop app, why do commands I already allowed wait for the island?**
The desktop app never runs Claude Code's `PermissionRequest` hook, so Nöbetçi asks from
`PreToolUse`, which comes before the app's own permission check and can't see your Claude allow
list. A request nobody answers waits up to 108 s, then the app decides as it would have. Pause
Nöbetçi before you leave such a session running unattended, or let LOW requests through with a
trusted project or rules.

## Uninstall

Nöbetçi's hooks live in other programs' settings files: `~/.claude/settings.json` for Claude
Code, and — if you connected them — Codex's `hooks.json` (in `$CODEX_HOME`, or `~/.codex`) and
`~/.cursor/hooks.json`. Take them out before the app goes. While the relay is still in place, a
forgotten hook does no harm: Claude Code and Codex ask as they always did, and Cursor asks you
itself. Once the relay is deleted, though, Claude Code reports a hook error on every step, and
Cursor — whose permission hooks Nöbetçi registers fail-closed — blocks every shell and MCP
command until its entries are removed.

`nobetci --remove-hooks` removes only Nöbetçi's own entries from all three files, leaves every
other setting and every other tool's hooks alone, and saves a dated backup next to each file
(`settings.json.bak-…`, `hooks.json.bak-…`). It shows no diff — it is the uninstaller's command.
(If an agent asks to run it, Nöbetçi scores it CRITICAL: only you should.) To review each change
instead, use **Settings → Claude Code → Remove…**, **Settings → ChatGPT → Remove connection…**
and **Settings → Other agents → Remove connection…**.

### Windows

Open **Settings → Apps → Installed apps** (**Apps & features** on Windows 10), find **Nobetci**
and choose **Uninstall**. The uninstaller:

1. asks you to close Nöbetçi if it is running — **Cancel** there leaves everything as it was;
2. runs `nobetci.exe --remove-hooks` (above) on the Claude Code, Codex and Cursor files;
3. removes the app, the relay (`%LOCALAPPDATA%\Nobetci\bin`), the log and **Start with Windows**.

If removing the hooks fails, the relay and the log stay where they are, so Claude Code, Codex and
Cursor keep working, and a message says which entries to delete by hand.

Your preferences and agenda (`%APPDATA%\Nobetci`) and history (`%LOCALAPPDATA%\Nobetci\audit.jsonl`)
stay, so a reinstall picks up where you left off. Tick **Delete the application data** in the
uninstaller to remove them too. Installing a newer (or older) version over the current one is an
update, not an uninstall: hooks, **Start with Windows** and data all stay.

### macOS

1. In Terminal, run `/Applications/Nobetci.app/Contents/MacOS/nobetci --remove-hooks` — or remove
   each connection in Settings, as above.
2. If **Start at login** is on, switch it off in **Settings → General**.
3. Quit Nöbetçi from the menu bar and move it from Applications to the Bin.

Your preferences, agenda, history and the relay stay in `~/Library/Application Support/Nobetci`;
delete that folder to remove every trace.

### Linux

1. Run `nobetci --remove-hooks` (`.deb`), or `./Nobetci-x.y.z-linux-amd64.AppImage --remove-hooks`
   — or remove each connection in Settings, as above.
2. If **Start at login** is on, switch it off in **Settings → General**
   (it is `~/.config/autostart/Nobetci.desktop`).
3. Quit Nöbetçi from the tray, then `sudo apt remove nobetci`, or delete the AppImage. The package
   manager runs as root and can't take the hooks out of your home folder, which is why step 1
   comes first.

Settings and the agenda stay in `~/.config/nobetci`, history, log and the relay in
`~/.local/share/nobetci`, the socket's folder in `~/.local/state/nobetci`; delete all three to
remove every trace.

## Development

```powershell
npm run dev          # builds the relay (needs Rust), then the UI alone in a browser, with demo data
npx vite             # the same browser preview without building the relay: no Rust needed
npm run tauri dev    # the real app, with live reload
npm test             # Rust tests
npm run lint         # clippy (warnings are errors) and the TypeScript typecheck
npm run pack         # the Windows installer, into release\
npm run pack:store:offline # Store-path Windows installer, into release/store\ (unsigned)
npm run pack:mac     # the macOS disk image (universal), into release/
npm run pack:linux   # the .deb and the AppImage, into release/
```

With the dev server running:

- `http://127.0.0.1:1420/?demo=critical` shows the island with fake sessions and requests. Other
  demos: `low`, `write`, `hidden`, `deny-menu`, `batch`, `question`, `plan`, `overview`,
  `session`, `assistant`, `compact`, `empty`, `tour`, `mascots`, `reactions`. Add `&theme=wolf`
  (or another mascot) to see it on the island.
- `http://127.0.0.1:1420/settings.html?tab=kurallar` opens Settings with mock data. Tabs:
  `genel`, `claude`, `chatgpt`, `ajanlar`, `prompts`, `guvenlik`, `kurallar`, `bildirimler`,
  `gecmis`, `hakkinda`, plus `hosgeldin` for the welcome wizard.
- Add `&lang=en` or `&lang=tr` to pick the language. In Settings, `&platform=macos` or
  `&platform=linux` shows the Mac or Linux wording.
- In the browser console, `nobetci.inject({ … })` feeds the island a fake hook event.

```text
hook/                  nobetci-hook — the relay Claude Code, Codex and Cursor run on every hook event
  src/win.rs · mac.rs · linux.rs   named pipe (Windows) / Unix socket (macOS, Linux), parent-process chain
  src/browser.rs       the ChatGPT Web bridge's native-messaging host
src-tauri/src/
  risk.rs · risk/      risk engine, categories and the reading of shell commands (+ tests)
  rules.rs             user rules, project trust, session grants (+ tests)
  pipe.rs              relay server and approval decisions
  pipe/                named_pipe.rs (Windows) · unix_socket.rs (macOS, Linux)
  audit.rs             history, statistics, CSV/JSON export (+ tests)
  redact.rs            secret masking for the history and notifications
  inputguard.rs        physical-click guard
  inputguard/          raw_input.rs (Windows Raw Input) · appkit.rs (macOS event source) · x11.rs (XInput2)
  hooks.rs             ~/.claude/settings.json install and removal (diff + backup)
  agent_hooks.rs       the same for Codex and Cursor
  settings.rs          preferences and their limits
  island.rs            the transparent, click-through island window
  sys.rs               small per-OS helpers: clock, language, full screen, home folder
  widgets.rs · widgets/  media, system load and weather for the island's cards
  agenda.rs · assistant.rs · buddy.rs · prompts.rs
  quiet.rs · focus.rs · hotkeys.rs · tray.rs · i18n.rs · x11.rs · mac_panel.rs
src/
  baykus/              the mascots, their greeting and mini heads (Canvas 2D)
  island/              state machine, hook events, geometry
  ui/                  island views, including the approval card
  core/                state, bridge to Rust, synthesised sounds
  buddy/               the desktop mascot
  settings/            the settings window
  i18n/                Turkish and English strings
scripts/               installer packaging, icon generator, screenshots, checks
```

| What | Windows | macOS | Linux |
| --- | --- | --- | --- |
| Preferences, agenda | `%APPDATA%\Nobetci\` | `~/Library/Application Support/Nobetci/` | `~/.config/nobetci/` |
| History | `%LOCALAPPDATA%\Nobetci\audit.jsonl` (+ `audit.1.jsonl`) | `~/Library/Application Support/Nobetci/audit.jsonl` | `~/.local/share/nobetci/audit.jsonl` |
| Log | `%LOCALAPPDATA%\Nobetci\nobetci.log` | `~/Library/Application Support/Nobetci/nobetci.log` | `~/.local/share/nobetci/nobetci.log` |
| Relay | `%LOCALAPPDATA%\Nobetci\bin\nobetci-hook.exe` | `~/Library/Application Support/Nobetci/bin/nobetci-hook` | `~/.local/share/nobetci/bin/nobetci-hook` |
| Claude Code hooks | `%USERPROFILE%\.claude\settings.json` | `~/.claude/settings.json` | `~/.claude/settings.json` |

Backups of the Claude Code settings sit next to them as `settings.json.bak-*`; Codex's and
Cursor's as `hooks.json.bak-*`. On Linux, `$XDG_CONFIG_HOME` and `$XDG_DATA_HOME` move the first
two folders when they are set.

Contributions are welcome — [CONTRIBUTING.md](CONTRIBUTING.md) has the setup, the ground rules and
how to report a false positive.

## Roadmap

Ideas, not promises:

- **Signed Windows releases** through SignPath Foundation — the release workflow is ready; see the
  [code signing policy](CODE_SIGNING_POLICY.md).
- **Notarized macOS builds**, so Gatekeeper opens them without a detour. The release workflow can
  already sign and notarize once the project has an Apple Developer ID.
- **More agents** — other coding agents that offer hooks or a permission API, and permission
  requests for more of what Codex and Cursor do.
- **A native Wayland island**, so shortcuts, **Go to window** and quiet in full screen see every
  window.
- **A richer assistant** on the island: more apps, voice input on Linux, answers that stay on
  screen.
- **Sharper rules** — more coverage and fewer false positives. Reports are very welcome.

## License

[MIT](LICENSE). See [NOTICE.md](NOTICE.md) for third-party notices.
