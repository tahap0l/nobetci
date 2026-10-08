; Uninstall hooks for the NSIS installer.
;
; The app stages nobetci-hook.exe into %LOCALAPPDATA%\Nobetci\bin at launch, so
; the installer never recorded it and the default uninstaller leaves it behind.
; The log lives in the same place and is ours too.
;
; Claude Code's settings.json: only Nöbetçi's own hook entries are removed, via
; `nobetci.exe --remove-hooks`, which keeps a dated backup next to the file and
; leaves every other setting and every other tool's hooks untouched. Uninstalling
; is the user asking for Nöbetçi to go; dead entries would be worse than none.

!macro NSIS_HOOK_PREUNINSTALL
  ; Take Nöbetçi's entries out of ~/.claude/settings.json (with a dated backup)
  ; while the relay is still there; otherwise Claude Code would report a missing
  ; hook command on every event after the uninstall. An update (/UPDATE) is not
  ; the user leaving: the hooks stay.
  ${If} $UpdateMode <> 1
    ExecWait '"$INSTDIR\nobetci.exe" --remove-hooks'
  ${EndIf}
  RMDir /r "$LOCALAPPDATA\Nobetci\bin"
  Delete "$LOCALAPPDATA\Nobetci\nobetci.log"
!macroend
