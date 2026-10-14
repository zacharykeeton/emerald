; Included by electron-builder's NSIS script (nsis.include). Puts
; <install>\resources\bin on the user's PATH so `emmer` works from any new
; terminal, and removes it on uninstall. The work is in emmer-path.ps1 next
; to the shim, so the same code runs from a terminal if a PATH ever needs
; repairing by hand. customUnInstall runs before the files are deleted, so
; the script is still there to run. It also runs `emmer hooks uninstall`
; through the installed shim, on a real uninstall only, never an update
; (M9 fix 630).
;
; M9 fixes 342 and 381: emerald as an opener for .md and .json, written here
; by hand rather than through electron-builder's fileAssociations block.
; That block's APP_ASSOCIATE macro (app-builder-lib's FileAssociation.nsh)
; also wrote the extension's classic default value, so a box that had
; never picked an opener for .md got emerald as the one Windows falls back
; on, and its APP_UNASSOCIATE removed only the OpenWithProgids value and
; the ProgId, leaving the default naming a ProgId that no longer existed.
; What is written: under SHELL_CONTEXT (HKCU for this per-user installer)
; a ProgId per extension with its description, DefaultIcon (the icon
; extraResources copies to resources\icon.ico) and open command, and the
; ProgId as a value under the extension's OpenWithProgids, which is what
; puts emerald in the "Open with" list; never the extension key's default,
; so a chosen opener stays the person's and one never chosen still meets
; the "how do you want to open" list. The uninstall deletes what it wrote
; and also clears a classic default that names one of our ProgIds, which
; repairs the boxes the fileAssociations installer touched. The ProgId
; names stay emerald.md and emerald.json; verify-m7-install.mjs reads them
; off the EMERALD_OPENWITH lines below.

!ifndef SHCNE_ASSOCCHANGED
  !define SHCNE_ASSOCCHANGED 0x08000000
!endif
!ifndef SHCNF_FLUSH
  !define SHCNF_FLUSH 0x1000
!endif

!macro EMERALD_OPENWITH EXT PROGID DESCRIPTION
  WriteRegStr SHELL_CONTEXT "Software\Classes\${PROGID}" "" "${DESCRIPTION}"
  WriteRegStr SHELL_CONTEXT "Software\Classes\${PROGID}\DefaultIcon" "" "$INSTDIR\resources\icon.ico"
  WriteRegStr SHELL_CONTEXT "Software\Classes\${PROGID}\shell" "" "open"
  WriteRegStr SHELL_CONTEXT "Software\Classes\${PROGID}\shell\open" "" "Open with emerald"
  WriteRegStr SHELL_CONTEXT "Software\Classes\${PROGID}\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
  WriteRegNone SHELL_CONTEXT "Software\Classes\.${EXT}\OpenWithProgids" "${PROGID}"
!macroend

!macro EMERALD_UNOPENWITH EXT PROGID
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.${EXT}\OpenWithProgids" "${PROGID}"
  DeleteRegKey SHELL_CONTEXT "Software\Classes\${PROGID}"
  ; The repair: a classic default the fileAssociations installer wrote
  ; names our ProgId; with the ProgId gone it would name nothing.
  ReadRegStr $1 SHELL_CONTEXT "Software\Classes\.${EXT}" ""
  ${If} $1 == "${PROGID}"
    DeleteRegValue SHELL_CONTEXT "Software\Classes\.${EXT}" ""
  ${EndIf}
!macroend

!macro customInstall
  nsExec::ExecToLog 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\resources\bin\emmer-path.ps1" add "$INSTDIR\resources\bin"'
  Pop $0
  !insertmacro EMERALD_OPENWITH "md" "emerald.md" "Markdown"
  !insertmacro EMERALD_OPENWITH "json" "emerald.json" "JSON"
  System::Call "shell32::SHChangeNotify(i,i,i,i) (${SHCNE_ASSOCCHANGED}, ${SHCNF_FLUSH}, 0, 0)"
!macroend

!macro customUnInstall
  ; M9 fix 630: Emerald's hooks out of Claude Code's settings, the status
  ; line before ours put back and the emmer-cli skill removed, while the
  ; shim and the CLI are still on disk. Never on an update: the installer
  ; runs the old uninstaller with --updated before every install, and an
  ; update must keep the hooks. The exit code is ignored on purpose, so an
  ; uninstall never stops on a settings file it cannot parse.
  ${ifNot} ${isUpdated}
    nsExec::ExecToLog 'cmd.exe /d /c ""$INSTDIR\resources\bin\emmer.cmd" hooks uninstall"'
    Pop $0
  ${endIf}
  nsExec::ExecToLog 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\resources\bin\emmer-path.ps1" remove "$INSTDIR\resources\bin"'
  Pop $0
  !insertmacro EMERALD_UNOPENWITH "md" "emerald.md"
  !insertmacro EMERALD_UNOPENWITH "json" "emerald.json"
  System::Call "shell32::SHChangeNotify(i,i,i,i) (${SHCNE_ASSOCCHANGED}, ${SHCNF_FLUSH}, 0, 0)"
!macroend
