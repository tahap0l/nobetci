; Install and uninstall hooks for the NSIS installer.
;
; The app stages nobetci-hook.exe into %LOCALAPPDATA%\Nobetci\bin at launch, so
; the installer never recorded it and the default uninstaller leaves it behind.
; The log lives in the same place and is ours too.
;
; Claude Code, Codex and Cursor: only Nöbetçi's own hook entries are removed, via
; `nobetci.exe --remove-hooks`, which keeps a dated backup next to each file and
; leaves every other setting and every other tool's hooks untouched. Uninstalling
; is the user asking for Nöbetçi to go; dead entries would be worse than none.
;
; An update is not the user leaving. installer.nsi runs the old version's
; uninstaller with /UPDATE whenever a different version replaces it, and then the
; hooks, the relay, the log, "Start with Windows" and the data all stay.

; 1 when --remove-hooks failed: some hook may still point at the relay, so the
; relay and the log (which says why) stay.
Var nobetci.HooksKept

!macro NSIS_HOOK_POSTINSTALL
  ; Put the relay where the hooks point right away; the app does the same at
  ; every launch. Uninstallers up to 2.4.1 delete it even during an update, and
  ; every hook would fail until Nöbetçi started again.
  SetShellVarContext current
  CreateDirectory "$LOCALAPPDATA\Nobetci\bin"
  CopyFiles /SILENT "$INSTDIR\nobetci-hook.exe" "$LOCALAPPDATA\Nobetci\bin"
  ; A hook running right now holds the old copy open; that copy is fine to keep.
  ClearErrors
!macroend

; installer.nsi inserts this after asking about a running Nöbetçi, so Cancel
; there leaves everything as it was.
!macro NSIS_HOOK_PREUNINSTALL
  StrCpy $nobetci.HooksKept 0
  ${If} $UpdateMode <> 1
    ; Take Nöbetçi's entries out of ~/.claude/settings.json and the Codex and
    ; Cursor hooks.json files (with dated backups) while the relay is still
    ; there; otherwise each tool would report a missing hook command.
    ClearErrors
    ExecWait '"$INSTDIR\nobetci.exe" --remove-hooks' $0
    ${If} ${Errors}
    ${OrIf} $0 <> 0
      StrCpy $nobetci.HooksKept 1
      DetailPrint "$(nobetciHooksKeptDetail)"
      ; Not in an unattended (/P or /S) run, which nobody is there to answer.
      ${If} $PassiveMode <> 1
        MessageBox MB_ICONEXCLAMATION|MB_OK "$(nobetciHooksKept)" /SD IDOK
      ${EndIf}
    ${Else}
      RMDir /r "$LOCALAPPDATA\Nobetci\bin"
      Delete "$LOCALAPPDATA\Nobetci\nobetci.log"
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

    ; "Delete the application data": the template removes only the WebView's
    ; folders, named after the bundle id. Nöbetçi's settings, agenda, history
    ; and log are in %APPDATA%\Nobetci and %LOCALAPPDATA%\Nobetci.
    ${If} $DeleteAppDataCheckboxState = 1
      SetShellVarContext current
      RMDir /r "$APPDATA\Nobetci"
      ${If} $nobetci.HooksKept = 1
        ; Everything but the relay and the log (see NSIS_HOOK_PREUNINSTALL).
        FindFirst $R8 $R9 "$LOCALAPPDATA\Nobetci\*"
        ${DoUntil} $R9 == ""
          ${If} $R9 != "."
          ${AndIf} $R9 != ".."
          ${AndIf} $R9 != "bin"
          ${AndIf} $R9 != "nobetci.log"
            RMDir /r "$LOCALAPPDATA\Nobetci\$R9"
            Delete "$LOCALAPPDATA\Nobetci\$R9"
          ${EndIf}
          FindNext $R8 $R9
        ${Loop}
        FindClose $R8
      ${Else}
        RMDir /r "$LOCALAPPDATA\Nobetci"
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend

; ── Look ─────────────────────────────────────────────────────────────────────
; Included before the pages, so these shape every page of the installer: dark
; welcome and finish pages and header in Nöbetçi's colours, with the owl. The
; pictures come from scripts/installer-art.mjs; installer-ui.nsh animates them.

!define NOBETCI_NSIS "${__FILEDIR__}"
!define NOBETCI_ART "${__FILEDIR__}\art"
!define MUI_BGCOLOR "0B0B0E"
!define MUI_TEXTCOLOR "F2F2F5"
!define MUI_HEADERIMAGE_RIGHT
!define MUI_WELCOMEFINISHPAGE_BITMAP_STRETCH FitControl
!define MUI_HEADERIMAGE_BITMAP_STRETCH FitControl
!define MUI_WELCOMEPAGE_TITLE "$(nobetciWelcomeTitle)"
!define MUI_WELCOMEPAGE_TEXT "$(nobetciWelcomeText)"
!define MUI_FINISHPAGE_TITLE "$(nobetciFinishTitle)"
!define MUI_FINISHPAGE_TEXT "$(nobetciFinishText)"
