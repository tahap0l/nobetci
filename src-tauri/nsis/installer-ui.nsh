; The owl on the installer's welcome and finish pages.
;
; MUI2 shows the sidebar picture (art/sidebar.bmp) on both pages. Over the
; owl's part of it we lay one small picture control and swap its frame every
; 80 ms: a wave on the welcome page, a cheer on the finish page, then a few
; seconds of rest before the next one. The frames are tiles of the very same
; sidebar (installer-art.ts), so the seam does not show.
;
; Included by installer.nsi after the pages and languages, because it uses the
; variables MUI2 declares for them.

!include "${NOBETCI_ART}\frames.nsh"

; The owl tile's place on the 164×314 sidebar (TILE in installer-art.ts).
!define NOBETCI_TILE_X 22
!define NOBETCI_TILE_Y 58
!define NOBETCI_TILE_W 120
!define NOBETCI_TILE_H 150
!define NOBETCI_FRAME_MS 80
; Ticks of rest between two runs of the animation.
!define NOBETCI_REST 40

Var nobetci.Unpacked
Var nobetci.Tile
Var nobetci.TileBmp
Var nobetci.Timer
Var nobetci.Seq
Var nobetci.Count
Var nobetci.Loop
Var nobetci.Frame

LangString nobetciWelcomeTitle ${LANG_TURKISH} "Nöbetçi'ye hoş geldin"
LangString nobetciWelcomeTitle ${LANG_ENGLISH} "Welcome to Nöbetçi"
LangString nobetciWelcomeText ${LANG_TURKISH} "Yapay zekâ ajanların kod yazarken Nöbetçi ekranının üstünde nöbet tutar: her izin isteğini gösterir, riskini sade bir dille anlatır ve son kararı sana bırakır.$\r$\n$\r$\nKurulum bir dakikadan kısa sürer ve yalnızca senin hesabına yapılır.$\r$\n$\r$\nDevam etmek için İleri'ye tıkla."
LangString nobetciWelcomeText ${LANG_ENGLISH} "While your AI agents write code, Nöbetçi keeps watch from the top of your screen: it shows every permission request, explains its risk in plain words and leaves the final call to you.$\r$\n$\r$\nSetup takes less than a minute and installs for your account only.$\r$\n$\r$\nClick Next to continue."
LangString nobetciFinishTitle ${LANG_TURKISH} "Nöbetçi nöbette!"
LangString nobetciFinishTitle ${LANG_ENGLISH} "Nöbetçi is on watch!"
LangString nobetciFinishText ${LANG_TURKISH} "Kurulum tamamlandı. Nöbetçi açıldığında kısa bir sihirbaz Claude Code'u bağlamana yardım eder; ekranın üstündeki adaya fareyi götürmen yeterli."
LangString nobetciFinishText ${LANG_ENGLISH} "All set. When Nöbetçi opens, a short wizard helps you connect Claude Code; just move the mouse to the island at the top of your screen."
; The uninstaller, when `nobetci.exe --remove-hooks` fails (hooks.nsh).
LangString nobetciHooksKeptDetail ${LANG_TURKISH} "Nöbetçi'nin hook'ları kaldırılamadı; aktarıcı ve günlük yerinde kalıyor."
LangString nobetciHooksKeptDetail ${LANG_ENGLISH} "Nöbetçi's hooks could not be removed; the relay and the log stay."
LangString nobetciHooksKept ${LANG_TURKISH} "Nöbetçi, hook'larını Claude Code, Codex ve Cursor ayarlarından kaldıramadı. Bu araçlar çalışmaya devam etsin diye aktarıcısı %LOCALAPPDATA%\Nobetci\bin klasöründe kalıyor; hangi dosyanın neden temizlenemediğini %LOCALAPPDATA%\Nobetci\nobetci.log dosyasında bulursun.$\r$\n$\r$\nElle bitirmek için o dosyadaki nobetci-hook geçen hook girdilerini sil: Claude Code'un settings.json dosyası (CLAUDE_CONFIG_DIR tanımladıysan o klasörde, yoksa %USERPROFILE%\.claude içinde), Codex'in hooks.json dosyası (CODEX_HOME tanımladıysan orada, yoksa %USERPROFILE%\.codex içinde) ya da %USERPROFILE%\.cursor\hooks.json. Sonra yalnızca %LOCALAPPDATA%\Nobetci\bin klasörünü ve nobetci.log dosyasını sil: %LOCALAPPDATA%\Nobetci içindeki geçmişin, uygulama verilerini silmeyi seçmediysen orada kalır."
LangString nobetciHooksKept ${LANG_ENGLISH} "Nöbetçi could not remove its hooks from the Claude Code, Codex and Cursor settings. Its relay stays in %LOCALAPPDATA%\Nobetci\bin so that those tools keep working, and %LOCALAPPDATA%\Nobetci\nobetci.log says which file could not be cleaned and why.$\r$\n$\r$\nTo finish by hand, delete the hook entries that mention nobetci-hook from that file: Claude Code's settings.json (in the CLAUDE_CONFIG_DIR folder if you set one, otherwise in %USERPROFILE%\.claude), Codex's hooks.json (in CODEX_HOME if you set it, otherwise in %USERPROFILE%\.codex) or %USERPROFILE%\.cursor\hooks.json. Then delete only the %LOCALAPPDATA%\Nobetci\bin folder and the nobetci.log file: your history in %LOCALAPPDATA%\Nobetci stays there unless you chose to delete the application data."

Function nobetci.Unpack
  ${If} $nobetci.Unpacked != 1
    InitPluginsDir
    !insertmacro NOBETCI_UNPACK_ART
    StrCpy $nobetci.Unpacked 1
  ${EndIf}
FunctionEnd

Function nobetci.ShowFrame
  IntFmt $0 "%02d" $nobetci.Frame
  ${If} $nobetci.TileBmp != ""
    ${NSD_FreeImage} $nobetci.TileBmp
  ${EndIf}
  ${NSD_SetStretchedImage} $nobetci.Tile "$PLUGINSDIR\$nobetci.Seq-$0.bmp" $nobetci.TileBmp
FunctionEnd

Function nobetci.Tick
  IntOp $nobetci.Frame $nobetci.Frame + 1
  ${If} $nobetci.Frame >= $nobetci.Loop
    StrCpy $nobetci.Frame 0
  ${EndIf}
  ${If} $nobetci.Frame < $nobetci.Count
    Call nobetci.ShowFrame
  ${EndIf}
FunctionEnd

; Lays the tile over the sidebar picture control on the stack and starts the timer.
Function nobetci.Start
  Exch $R1
  Push $R0
  Push $R2
  Push $R3
  Push $R4
  Push $R5
  Push $R6
  Push $R7
  Push $R8
  ; The sidebar must not paint over the tile.
  System::Call "user32::GetWindowLongW(p $R1, i -16) i .R0"
  IntOp $R0 $R0 | 0x04000000
  System::Call "user32::SetWindowLongW(p $R1, i -16, i $R0)"
  ; The sidebar's real size in pixels (it scales with the screen's DPI).
  System::Call "*(i 0, i 0, i 0, i 0) p .R2"
  System::Call "user32::GetClientRect(p $R1, p $R2)"
  System::Call "*$R2(i, i, i .R3, i .R4)"
  System::Free $R2
  IntOp $R5 $R3 * ${NOBETCI_TILE_X}
  IntOp $R5 $R5 / 164
  IntOp $R6 $R4 * ${NOBETCI_TILE_Y}
  IntOp $R6 $R6 / 314
  IntOp $R7 $R3 * ${NOBETCI_TILE_W}
  IntOp $R7 $R7 / 164
  IntOp $R8 $R4 * ${NOBETCI_TILE_H}
  IntOp $R8 $R8 / 314
  nsDialogs::CreateControl STATIC ${WS_CHILD}|${WS_VISIBLE}|${SS_BITMAP} 0 $R5 $R6 $R7 $R8 ""
  Pop $nobetci.Tile
  ; On top of the sidebar (HWND_TOP; no move, no size, no focus).
  System::Call "user32::SetWindowPos(p $nobetci.Tile, p 0, i 0, i 0, i 0, i 0, i 0x13)"
  StrCpy $nobetci.TileBmp ""
  StrCpy $nobetci.Frame 0
  IntOp $nobetci.Loop $nobetci.Count + ${NOBETCI_REST}
  Call nobetci.ShowFrame
  ${NSD_CreateTimer} nobetci.Tick ${NOBETCI_FRAME_MS}
  StrCpy $nobetci.Timer 1
  Pop $R8
  Pop $R7
  Pop $R6
  Pop $R5
  Pop $R4
  Pop $R3
  Pop $R2
  Pop $R0
  Pop $R1
FunctionEnd

Function nobetci.Stop
  ${If} $nobetci.Timer == 1
    ${NSD_KillTimer} nobetci.Tick
    StrCpy $nobetci.Timer 0
  ${EndIf}
  ${If} $nobetci.TileBmp != ""
    ${NSD_FreeImage} $nobetci.TileBmp
    StrCpy $nobetci.TileBmp ""
  ${EndIf}
FunctionEnd

Function nobetci.WelcomeShow
  Call nobetci.Unpack
  StrCpy $nobetci.Seq "wave"
  StrCpy $nobetci.Count ${NOBETCI_WAVE_FRAMES}
  Push $mui.WelcomePage.Image
  Call nobetci.Start
FunctionEnd

Function nobetci.FinishShow
  Call nobetci.Unpack
  StrCpy $nobetci.Seq "cheer"
  StrCpy $nobetci.Count ${NOBETCI_CHEER_FRAMES}
  Push $mui.FinishPage.Image
  Call nobetci.Start
  ; Themed check boxes ignore the page's text colour (black on black): draw
  ; them unthemed so the light text shows.
  ${If} $mui.FinishPage.Run != ""
    System::Call 'uxtheme::SetWindowTheme(p $mui.FinishPage.Run, w " ", w " ")'
  ${EndIf}
  ${If} $mui.FinishPage.ShowReadme != ""
    System::Call 'uxtheme::SetWindowTheme(p $mui.FinishPage.ShowReadme, w " ", w " ")'
  ${EndIf}
FunctionEnd
