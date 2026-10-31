#!/bin/sh
# Claude Code's status line off Windows (M9 fix 1021), set by emmer hooks
# install, the mirror of claude-statusline.cmd. Runs the script beside this
# file under the same Node the installer ran on, which is the app's own
# executable once installed; ELECTRON_RUN_AS_NODE makes that executable
# behave as node and is harmless for a plain node.
ELECTRON_RUN_AS_NODE=1
export ELECTRON_RUN_AS_NODE
exec "__EMERALD_NODE__" "$(dirname "$0")/claude-statusline.js"
