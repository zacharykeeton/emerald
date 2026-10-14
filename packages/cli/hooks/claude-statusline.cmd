@echo off
rem Claude Code's status line, set by emmer hooks install. Runs the script
rem beside this file under the same Node the installer ran on, which is the
rem app's own Emerald.exe once installed; ELECTRON_RUN_AS_NODE makes that exe
rem behave as node and is harmless for a plain node.
setlocal
set "ELECTRON_RUN_AS_NODE=1"
"__EMERALD_NODE__" "%~dp0claude-statusline.js"
exit /b %ERRORLEVEL%
