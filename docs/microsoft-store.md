# Microsoft Store preparation

This guide describes the current Store build path for Nöbetçi. A package built with the command
below is **offline**, but it is not ready for Store submission until it is signed and the remaining
Partner Center requirements are completed.

## Current package

Regular Windows releases use Tauri's NSIS setup executable. The regular installer can download
WebView2 if needed, which is unsuitable for Microsoft's offline MSI/EXE submission path. The
Store-specific Tauri overlay bundles the WebView2 offline installer without changing the normal
GitHub release installer.

From a Windows build environment with the project's Node.js and Rust dependencies installed, run:

```powershell
npm run pack:store:offline
```

The resulting package is written to `release/store/Nobetci-<version>-setup.exe`. It supports the
NSIS silent-install switch `/S`. Tauri's offline WebView2 mode adds about 127 MB to the installer.

## Required before submission

1. Sign the setup executable and every bundled PE executable with a code-signing certificate
   chaining to a CA in Microsoft's Trusted Root Program. Current public releases are not signed.
2. Keep the Store package as a standalone installer. It must not download dependencies or other
   binaries during installation. Test `/S` and confirm the installation only installs Nöbetçi.
3. Host each submitted version at a reliable HTTPS download URL. Use a new versioned URL for each
   binary and never replace a submitted binary at the same URL.
4. Create or complete the developer account in Partner Center, reserve the app name, and provide
   the package URL, architecture, installer type, and `/S` installer parameter.
5. Complete the Store listing: description, category, age rating, screenshots, support details, and
   this privacy policy at `https://github.com/tahap0l/nobetci/blob/main/PRIVACY.md`. Desktop
   screenshots must be at least 1366×768; one is required and four are recommended. Existing README
   screenshots are too small, so capture new images at 2× scale.
6. Submit for certification. For each update, sign and host a new immutable package, then submit
   its new versioned URL in Partner Center. Store delivery of EXE updates is not automatic; the
   installer or app must manage updates.

Microsoft also recommends MSIX for Store publishing because the Store can sign it and deliver
updates. Nöbetçi does not currently produce MSIX; validate the Claude Code hook integration and
other installer behavior before switching packaging formats.

## Store listing draft

**Name:** Nöbetçi

**Short description:** Review Claude Code permission requests and prepare clearer messages for AI
agents.

**Long description:** Nöbetçi keeps Claude Code permission requests visible while you work. It shows
why a request may be risky and lets you decide whether to allow or deny it. Prompt Studio can help
improve a message for Claude Code, Codex, Cursor, ChatGPT, Gemini, or another agent. Drafts stay
local with Ollama, unless you choose a cloud model. If you select OpenAI, the draft is sent only when
you choose Improve. Nöbetçi never sends the rewritten message to an agent automatically; review and
copy it yourself.

**Category:** Developer tools

**Privacy policy:** `https://github.com/tahap0l/nobetci/blob/main/PRIVACY.md`

## Store screenshot capture

Start a frontend-only dev server with `npx vite --host 127.0.0.1`, then capture the four product
screens in both languages without overwriting the README images:

```powershell
$env:NOBETCI_SCALE = "2"
$env:NOBETCI_OUT = "store-assets"
node scripts/screenshots.mjs en tr critical overview session settings-prompts
```

This writes English and Turkish PNGs under `store-assets/`. Confirm they show the actual app
features and are at least 1366×768 before uploading them to Partner Center.
