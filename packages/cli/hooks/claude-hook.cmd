@echo off
rem A hosted Claude posts with the session, token and port its pty
rem environment carries. One emerald did not start (M9 fix 233) has no
rem session stamp: the port and token come off daemon.json under
rem EMERALD_HOME or the profile's .emerald, X-Emerald-Unhosted says so and
rem the daemon takes the conversation's id from the payload's session_id
rem (M9 fix 580: curl here too, where node took 89 to 363 ms a hook).
rem X-Emerald-Hook names this file, so the daemon can fold the same event
rem posted by another hook set (M9 fix 260).
if "%EMERALD_SESSION_ID%"=="" goto unhosted
if "%EMERALD_HOOK_PORT%"=="" exit /b 0
"%SystemRoot%\System32\curl.exe" -sS -X POST "http://127.0.0.1:%EMERALD_HOOK_PORT%/hook" --connect-timeout 0.5 --max-time 1.5 -H "Content-Type: application/json" -H "X-Emerald-Token: %EMERALD_HOOK_TOKEN%" -H "X-Emerald-Session: %EMERALD_SESSION_ID%" -H "X-Emerald-Hook: %~f0" --data-binary @- >nul 2>&1
exit /b 0
:unhosted
setlocal
rem No daemon.json is no daemon to post to (M9 fix 467). emmerd writes it
rem one key per line, so the loop reads it in this process with no child:
rem a key it does not find, a file written on one line or a half written
rem one leaves the post unsent. The token is hex and holds no space.
rem Delayed expansion stays off, so a bang in a path is kept.
if "%EMERALD_HOME%"=="" set "EMERALD_HOME=%USERPROFILE%\.emerald"
if not exist "%EMERALD_HOME%\daemon.json" exit /b 0
set "HOOKPORT="
set "HOOKTOKEN="
for /f "usebackq tokens=1,2 delims=:, " %%a in ("%EMERALD_HOME%\daemon.json") do (
  if "%%~a"=="hookPort" set "HOOKPORT=%%~b"
  if "%%~a"=="hookToken" set "HOOKTOKEN=%%~b"
)
if "%HOOKPORT%"=="" exit /b 0
if "%HOOKTOKEN%"=="" exit /b 0
"%SystemRoot%\System32\curl.exe" -sS -X POST "http://127.0.0.1:%HOOKPORT%/hook" --connect-timeout 0.5 --max-time 1.5 -H "Content-Type: application/json" -H "X-Emerald-Token: %HOOKTOKEN%" -H "X-Emerald-Unhosted: 1" -H "X-Emerald-Hook: %~f0" --data-binary @- >nul 2>&1
exit /b 0
