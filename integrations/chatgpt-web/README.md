# ChatGPT Web bridge

**English** · [Türkçe](README.tr.md)

While chatgpt.com writes a response in Chrome or Edge, Nöbetçi shows a **ChatGPT Web** session on
the island. When the response is finished the session says so, and closing the tab removes it.

**Windows only.** Only this folder's Windows script registers the bridge with the browser. macOS and
Linux have no registration, so there the extension has nothing to talk to.

## What it sends

The extension watches one thing: whether ChatGPT's stop button is on the page. It sends Nöbetçi a
random session id and one of three states: working, finished or closed. Never the conversation,
its title, its address or your cookies.

There are no approvals for ChatGPT Web. ChatGPT in the browser runs nothing on your computer, so
there is nothing to approve.

## Set up

1. Install the latest Nöbetçi and open it once: it puts its relay in `%LOCALAPPDATA%\Nobetci\bin`.
   Nöbetçi 2.1.4 to 2.4.1 drop the bridge's messages, so nothing appears on the island with them.
   The release after 2.4.1 fixes this.
2. Open `chrome://extensions` in Chrome or `edge://extensions` in Edge. Turn on **Developer mode**,
   choose **Load unpacked** and pick the `extension` folder here.
3. Copy the extension's ID (32 letters from a to p). Open PowerShell in this folder and run the
   command below. For Edge, use `-Browser Edge`.

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File .\register-windows.ps1 -ExtensionId YOUR_EXTENSION_ID -Browser Chrome
   ```

   `-ExecutionPolicy Bypass` applies to this one run and does not change your system's policy.
   Without it, Windows refuses to run the script: unsigned scripts are blocked by default, and so are
   files from a downloaded ZIP.
4. Reload the ChatGPT tab and start a response. The island shows a working session, then a finished
   one.

The script writes `%LOCALAPPDATA%\Nobetci\chatgpt-native-host-Chrome.json` (or `-Edge.json`) and
points the registry key
`HKCU\Software\Google\Chrome\NativeMessagingHosts\io.github.tahap0l.nobetci.chatgpt` (or the same
key under `Microsoft\Edge`) at it. It changes nothing else and needs no administrator rights. Its
messages follow your Windows display language.

## Remove

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\unregister-windows.ps1
```

This removes the registration for both browsers; add `-Browser Chrome` or `-Browser Edge` for one.
Then remove the extension in `chrome://extensions` or `edge://extensions`. Run it when you uninstall
Nöbetçi too: a registration left behind points the browser at a relay that is no longer there.

## When nothing shows up

- **Is Nöbetçi running?** While it is closed, the extension waits longer and longer between tries:
  5 seconds, then twice as long each time, up to a minute. Open Nöbetçi again and the island catches
  up within a minute.
- **Right browser, right ID?** Run the register script again with the ID that `chrome://extensions`
  shows now. An unpacked extension gets a new ID when its folder moves.
- **Has ChatGPT changed?** The bridge watches ChatGPT's stop button
  (`button[data-testid="stop-button"]`). If ChatGPT changes that button, the bridge needs an update.
