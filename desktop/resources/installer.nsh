!macro customInstall
  InitPluginsDir
  SetOutPath "$PLUGINSDIR\canvas-icons"
  File /oname=refresh-icons.ps1 "${PROJECT_DIR}\desktop\refresh-windows-icons.ps1"
  File /oname=icon.ico "${BUILD_RESOURCES_DIR}\icon.ico"
  StrCpy $2 "$SYSDIR\WindowsPowerShell\v1.0\powershell.exe"
  IfFileExists "$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe" 0 +2
  StrCpy $2 "$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe"
  nsExec::ExecToStack '"$2" -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "$PLUGINSDIR\canvas-icons\refresh-icons.ps1" -Executable "$INSTDIR\${APP_EXECUTABLE_FILENAME}" -IconSource "$PLUGINSDIR\canvas-icons\icon.ico"'
  Pop $0
  Pop $1
  DetailPrint "$1"
  SetOutPath "$INSTDIR"
!macroend
