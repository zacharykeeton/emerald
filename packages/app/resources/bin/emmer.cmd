@echo off
rem emmer CLI shim for the installed layout: <install>\resources\bin\emmer.cmd.
rem Runs the CLI under the app's own Emerald.exe as Node, so an install never
rem depends on whichever Node the machine has. When there is no Emerald.exe two
rem levels up (the stage directory checked in development) it uses node.
setlocal
set "EMERALD_RES=%~dp0.."
if exist "%EMERALD_RES%\..\Emerald.exe" (
  set "EMERALD_NODE=%EMERALD_RES%\..\Emerald.exe"
  set "ELECTRON_RUN_AS_NODE=1"
) else (
  set "EMERALD_NODE=node"
)
"%EMERALD_NODE%" "%EMERALD_RES%\cli\dist\main.js" %*
exit /b %ERRORLEVEL%
