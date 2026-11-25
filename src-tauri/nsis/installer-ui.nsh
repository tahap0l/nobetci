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

!include "${NOBI_ART}\frames.nsh"

; The owl tile's place on the 164×314 sidebar (TILE in installer-art.ts).
!define NOBI_TILE_X 22
!define NOBI_TILE_Y 58
!define NOBI_TILE_W 120
!define NOBI_TILE_H 150
!define NOBI_FRAME_MS 80
; Ticks of rest between two runs of the animation.
!define NOBI_REST 40

Var nobi.Unpacked
Var nobi.Tile
Var nobi.TileBmp
Var nobi.Timer
Var nobi.Seq
Var nobi.Count
Var nobi.Loop
Var nobi.Frame

LangString nobiWelcomeTitle ${LANG_TURKISH} "Nobi'ye hoş geldin"
LangString nobiWelcomeTitle ${LANG_ENGLISH} "Welcome to Nobi"
LangString nobiWelcomeText ${LANG_TURKISH} "Yapay zekâ ajanların kod yazarken Nobi ekranının üstünde nöbet tutar: her izin isteğini gösterir, riskini sade bir dille anlatır ve son kararı sana bırakır.$\r$\n$\r$\nKurulum bir dakikadan kısa sürer ve yalnızca senin hesabına yapılır.$\r$\n$\r$\nDevam etmek için İleri'ye tıkla."
LangString nobiWelcomeText ${LANG_ENGLISH} "While your AI agents write code, Nobi keeps watch from the top of your screen: it shows every permission request, explains its risk in plain words and leaves the final call to you.$\r$\n$\r$\nSetup takes less than a minute and installs for your account only.$\r$\n$\r$\nClick Next to continue."
LangString nobiFinishTitle ${LANG_TURKISH} "Nobi nöbette!"
LangString nobiFinishTitle ${LANG_ENGLISH} "Nobi is on watch!"
LangString nobiFinishText ${LANG_TURKISH} "Kurulum tamamlandı. Nobi açıldığında kısa bir sihirbaz Claude Code'u bağlamana yardım eder; ekranın üstündeki adaya fareyi götürmen yeterli."
LangString nobiFinishText ${LANG_ENGLISH} "All set. When Nobi opens, a short wizard helps you connect Claude Code; just move the mouse to the island at the top of your screen."
; The uninstaller, when `nobi.exe --remove-hooks` fails (hooks.nsh).
LangString nobiRemovingOld ${LANG_TURKISH} "Eski Nöbetçi kurulumu kaldırılıyor; ayarların Nobi'ye taşınacak."
LangString nobiRemovingOld ${LANG_ENGLISH} "Removing the old Nöbetçi install; your settings move to Nobi."
LangString nobiHooksKeptDetail ${LANG_TURKISH} "Nobi'nin hook'ları kaldırılamadı; aktarıcı ve günlük yerinde kalıyor."
LangString nobiHooksKeptDetail ${LANG_ENGLISH} "Nobi's hooks could not be removed; the relay and the log stay."
LangString nobiHooksKept ${LANG_TURKISH} "Nobi, hook'larını Claude Code, Codex ve Cursor ayarlarından kaldıramadı. Bu araçlar çalışmaya devam etsin diye aktarıcısı %LOCALAPPDATA%\Nobi\bin klasöründe kalıyor; hangi dosyanın neden temizlenemediğini %LOCALAPPDATA%\Nobi\nobi.log dosyasında bulursun.$\r$\n$\r$\nElle bitirmek için o dosyadaki nobi-hook geçen hook girdilerini sil: Claude Code'un settings.json dosyası (CLAUDE_CONFIG_DIR tanımladıysan o klasörde, yoksa %USERPROFILE%\.claude içinde), Codex'in hooks.json dosyası (CODEX_HOME tanımladıysan orada, yoksa %USERPROFILE%\.codex içinde) ya da %USERPROFILE%\.cursor\hooks.json. Sonra yalnızca %LOCALAPPDATA%\Nobi\bin klasörünü ve nobi.log dosyasını sil: %LOCALAPPDATA%\Nobi içindeki geçmişin, uygulama verilerini silmeyi seçmediysen orada kalır."
LangString nobiHooksKept ${LANG_ENGLISH} "Nobi could not remove its hooks from the Claude Code, Codex and Cursor settings. Its relay stays in %LOCALAPPDATA%\Nobi\bin so that those tools keep working, and %LOCALAPPDATA%\Nobi\nobi.log says which file could not be cleaned and why.$\r$\n$\r$\nTo finish by hand, delete the hook entries that mention nobi-hook from that file: Claude Code's settings.json (in the CLAUDE_CONFIG_DIR folder if you set one, otherwise in %USERPROFILE%\.claude), Codex's hooks.json (in CODEX_HOME if you set it, otherwise in %USERPROFILE%\.codex) or %USERPROFILE%\.cursor\hooks.json. Then delete only the %LOCALAPPDATA%\Nobi\bin folder and the nobi.log file: your history in %LOCALAPPDATA%\Nobi stays there unless you chose to delete the application data."

Function nobi.Unpack
  ${If} $nobi.Unpacked != 1
    InitPluginsDir
    !insertmacro NOBI_UNPACK_ART
    StrCpy $nobi.Unpacked 1
  ${EndIf}
FunctionEnd

Function nobi.ShowFrame
  IntFmt $0 "%02d" $nobi.Frame
  ${If} $nobi.TileBmp != ""
    ${NSD_FreeImage} $nobi.TileBmp
  ${EndIf}
  ${NSD_SetStretchedImage} $nobi.Tile "$PLUGINSDIR\$nobi.Seq-$0.bmp" $nobi.TileBmp
FunctionEnd

Function nobi.Tick
  IntOp $nobi.Frame $nobi.Frame + 1
  ${If} $nobi.Frame >= $nobi.Loop
    StrCpy $nobi.Frame 0
  ${EndIf}
  ${If} $nobi.Frame < $nobi.Count
    Call nobi.ShowFrame
  ${EndIf}
FunctionEnd

; Lays the tile over the sidebar picture control on the stack and starts the timer.
Function nobi.Start
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
  IntOp $R5 $R3 * ${NOBI_TILE_X}
  IntOp $R5 $R5 / 164
  IntOp $R6 $R4 * ${NOBI_TILE_Y}
  IntOp $R6 $R6 / 314
  IntOp $R7 $R3 * ${NOBI_TILE_W}
  IntOp $R7 $R7 / 164
  IntOp $R8 $R4 * ${NOBI_TILE_H}
  IntOp $R8 $R8 / 314
  nsDialogs::CreateControl STATIC ${WS_CHILD}|${WS_VISIBLE}|${SS_BITMAP} 0 $R5 $R6 $R7 $R8 ""
  Pop $nobi.Tile
  ; On top of the sidebar (HWND_TOP; no move, no size, no focus).
  System::Call "user32::SetWindowPos(p $nobi.Tile, p 0, i 0, i 0, i 0, i 0, i 0x13)"
  StrCpy $nobi.TileBmp ""
  StrCpy $nobi.Frame 0
  IntOp $nobi.Loop $nobi.Count + ${NOBI_REST}
  Call nobi.ShowFrame
  ${NSD_CreateTimer} nobi.Tick ${NOBI_FRAME_MS}
  StrCpy $nobi.Timer 1
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

Function nobi.Stop
  ${If} $nobi.Timer == 1
    ${NSD_KillTimer} nobi.Tick
    StrCpy $nobi.Timer 0
  ${EndIf}
  ${If} $nobi.TileBmp != ""
    ${NSD_FreeImage} $nobi.TileBmp
    StrCpy $nobi.TileBmp ""
  ${EndIf}
FunctionEnd

Function nobi.WelcomeShow
  Call nobi.Unpack
  StrCpy $nobi.Seq "wave"
  StrCpy $nobi.Count ${NOBI_WAVE_FRAMES}
  Push $mui.WelcomePage.Image
  Call nobi.Start
FunctionEnd

Function nobi.FinishShow
  Call nobi.Unpack
  StrCpy $nobi.Seq "cheer"
  StrCpy $nobi.Count ${NOBI_CHEER_FRAMES}
  Push $mui.FinishPage.Image
  Call nobi.Start
  ; Themed check boxes ignore the page's text colour (black on black): draw
  ; them unthemed so the light text shows.
  ${If} $mui.FinishPage.Run != ""
    System::Call 'uxtheme::SetWindowTheme(p $mui.FinishPage.Run, w " ", w " ")'
  ${EndIf}
  ${If} $mui.FinishPage.ShowReadme != ""
    System::Call 'uxtheme::SetWindowTheme(p $mui.FinishPage.ShowReadme, w " ", w " ")'
  ${EndIf}
FunctionEnd
