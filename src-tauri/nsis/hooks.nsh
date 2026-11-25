; Install and uninstall hooks for the NSIS installer.
;
; The app stages nobi-hook.exe into %LOCALAPPDATA%\Nobi\bin at launch, so
; the installer never recorded it and the default uninstaller leaves it behind.
; The log lives in the same place and is ours too.
;
; Claude Code, Codex and Cursor: only Nobi's own hook entries are removed, via
; `nobi.exe --remove-hooks`, which keeps a dated backup next to each file and
; leaves every other setting and every other tool's hooks untouched. Uninstalling
; is the user asking for Nobi to go; dead entries would be worse than none.
;
; An update is not the user leaving. installer.nsi runs the old version's
; uninstaller with /UPDATE whenever a different version replaces it, and then the
; hooks, the relay, the log, "Start with Windows" and the data all stay.

; 1 when --remove-hooks failed: some hook may still point at the relay, so the
; relay and the log (which says why) stay.
Var nobi.HooksKept

; Nobi was called Nöbetçi before 3.0, installed as "Nobetci" with its own
; folder, shortcuts and uninstaller. That install goes first, silently: its hook
; entries come out (with dated backups), its relay and shortcuts go, and its
; settings, rules, history and agenda stay in %APPDATA%\Nobetci and
; %LOCALAPPDATA%\Nobetci, where Nobi copies them from at its first start.
; "_?=" runs the uninstaller in place, so ExecWait waits for it.
!macro NSIS_HOOK_PREINSTALL
  SetShellVarContext current
  ${If} ${FileExists} "$LOCALAPPDATA\Nobetci\uninstall.exe"
    DetailPrint "$(nobiRemovingOld)"
    ClearErrors
    ExecWait '"$LOCALAPPDATA\Nobetci\uninstall.exe" /S _?=$LOCALAPPDATA\Nobetci' $0
    Delete "$LOCALAPPDATA\Nobetci\uninstall.exe"
    ClearErrors
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; Put the relay where the hooks point right away; the app does the same at
  ; every launch. Uninstallers up to 2.4.1 delete it even during an update, and
  ; every hook would fail until Nobi started again.
  SetShellVarContext current
  CreateDirectory "$LOCALAPPDATA\Nobi\bin"
  CopyFiles /SILENT "$INSTDIR\nobi-hook.exe" "$LOCALAPPDATA\Nobi\bin"
  ; A hook running right now holds the old copy open; that copy is fine to keep.
  ClearErrors
!macroend

; installer.nsi inserts this after asking about a running Nobi, so Cancel
; there leaves everything as it was.
!macro NSIS_HOOK_PREUNINSTALL
  StrCpy $nobi.HooksKept 0
  ${If} $UpdateMode <> 1
    ; Take Nobi's entries out of ~/.claude/settings.json and the Codex and
    ; Cursor hooks.json files (with dated backups) while the relay is still
    ; there; otherwise each tool would report a missing hook command.
    ClearErrors
    ExecWait '"$INSTDIR\nobi.exe" --remove-hooks' $0
    ${If} ${Errors}
    ${OrIf} $0 <> 0
      StrCpy $nobi.HooksKept 1
      DetailPrint "$(nobiHooksKeptDetail)"
      ; Not in an unattended (/P or /S) run, which nobody is there to answer.
      ${If} $PassiveMode <> 1
        MessageBox MB_ICONEXCLAMATION|MB_OK "$(nobiHooksKept)" /SD IDOK
      ${EndIf}
    ${Else}
      RMDir /r "$LOCALAPPDATA\Nobi\bin"
      Delete "$LOCALAPPDATA\Nobi\nobi.log"
    ${EndIf}
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $UpdateMode <> 1
    ; "Start with Windows" from a run with administrator rights is written to
    ; the machine-wide Run key, which the template leaves behind. Without those
    ; rights these fail quietly. Task Manager keeps its own switch next to each.
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "${PRODUCTNAME}"
    DeleteRegValue HKLM "Software\Microsoft\Windows\CurrentVersion\Run" "${PRODUCTNAME}"
    DeleteRegValue HKLM "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "${PRODUCTNAME}"
    ClearErrors

    ; The ChatGPT Web bridge, if integrations\chatgpt-web\register-windows.ps1
    ; was run: Chrome's and Edge's per-user native-messaging keys and the two
    ; manifests they point to, as unregister-windows.ps1 removes them. Nobi
    ; is leaving, so its bridge goes too, even when the relay stays for hooks
    ; that could not be removed. Missing keys and files are fine.
    SetShellVarContext current
    DeleteRegKey HKCU "Software\Google\Chrome\NativeMessagingHosts\io.github.tahap0l.nobi.chatgpt"
    DeleteRegKey HKCU "Software\Microsoft\Edge\NativeMessagingHosts\io.github.tahap0l.nobi.chatgpt"
    Delete "$LOCALAPPDATA\Nobi\chatgpt-native-host-Chrome.json"
    Delete "$LOCALAPPDATA\Nobi\chatgpt-native-host-Edge.json"
    ClearErrors

    ; "Delete the application data": the template removes only the WebView's
    ; folders, named after the bundle id. Nobi's settings, agenda, history
    ; and log are in %APPDATA%\Nobi and %LOCALAPPDATA%\Nobi.
    ${If} $DeleteAppDataCheckboxState = 1
      SetShellVarContext current
      RMDir /r "$APPDATA\Nobi"
      ${If} $nobi.HooksKept = 1
        ; Everything but the relay and the log (see NSIS_HOOK_PREUNINSTALL).
        FindFirst $R8 $R9 "$LOCALAPPDATA\Nobi\*"
        ${DoUntil} $R9 == ""
          ${If} $R9 != "."
          ${AndIf} $R9 != ".."
          ${AndIf} $R9 != "bin"
          ${AndIf} $R9 != "nobi.log"
            RMDir /r "$LOCALAPPDATA\Nobi\$R9"
            Delete "$LOCALAPPDATA\Nobi\$R9"
          ${EndIf}
          FindNext $R8 $R9
        ${Loop}
        FindClose $R8
      ${Else}
        RMDir /r "$LOCALAPPDATA\Nobi"
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend

; ── Look ─────────────────────────────────────────────────────────────────────
; Included before the pages, so these shape every page of the installer: dark
; welcome and finish pages and header in Nobi's colours, with the owl. The
; pictures come from scripts/installer-art.mjs; installer-ui.nsh animates them.

!define NOBI_NSIS "${__FILEDIR__}"
!define NOBI_ART "${__FILEDIR__}\art"
!define MUI_BGCOLOR "0B0B0E"
!define MUI_TEXTCOLOR "F2F2F5"
!define MUI_HEADERIMAGE_RIGHT
!define MUI_WELCOMEFINISHPAGE_BITMAP_STRETCH FitControl
!define MUI_HEADERIMAGE_BITMAP_STRETCH FitControl
!define MUI_WELCOMEPAGE_TITLE "$(nobiWelcomeTitle)"
!define MUI_WELCOMEPAGE_TEXT "$(nobiWelcomeText)"
!define MUI_FINISHPAGE_TITLE "$(nobiFinishTitle)"
!define MUI_FINISHPAGE_TEXT "$(nobiFinishText)"
