#!/bin/sh
# The hook off Windows (M9 fix 1021), the mirror of claude-hook.cmd. A
# hosted Claude posts with the session, token and port its pty environment
# carries. One emerald did not start (M9 fix 233) has no session stamp: the
# port and token come off daemon.json under EMERALD_HOME or ~/.emerald,
# X-Emerald-Unhosted says so and the daemon takes the conversation's id from
# the payload's session_id. X-Emerald-Hook names this file, so the daemon
# can fold the same event posted by another hook set (M9 fix 260). emmerd
# writes daemon.json one key per line, so each sed reads one key: a key it
# does not find, a file written on one line or a half written one leaves
# the post unsent, as the .cmd's loop does. curl is named by its path, as
# the .cmd names System32's; macOS and Ubuntu both ship it there.
if [ -z "$EMERALD_SESSION_ID" ]; then
  home=${EMERALD_HOME:-$HOME/.emerald}
  [ -f "$home/daemon.json" ] || exit 0
  port=$(sed -n 's/^ *"hookPort": *\([0-9][0-9]*\).*/\1/p' "$home/daemon.json")
  token=$(sed -n 's/^ *"hookToken": *"\([0-9a-f][0-9a-f]*\)".*/\1/p' "$home/daemon.json")
  if [ -z "$port" ] || [ -z "$token" ]; then exit 0; fi
  /usr/bin/curl -sS -X POST "http://127.0.0.1:$port/hook" --connect-timeout 0.5 --max-time 1.5 -H "Content-Type: application/json" -H "X-Emerald-Token: $token" -H "X-Emerald-Unhosted: 1" -H "X-Emerald-Hook: $0" --data-binary @- >/dev/null 2>&1
  exit 0
fi
[ -n "$EMERALD_HOOK_PORT" ] || exit 0
/usr/bin/curl -sS -X POST "http://127.0.0.1:$EMERALD_HOOK_PORT/hook" --connect-timeout 0.5 --max-time 1.5 -H "Content-Type: application/json" -H "X-Emerald-Token: $EMERALD_HOOK_TOKEN" -H "X-Emerald-Session: $EMERALD_SESSION_ID" -H "X-Emerald-Hook: $0" --data-binary @- >/dev/null 2>&1
exit 0
