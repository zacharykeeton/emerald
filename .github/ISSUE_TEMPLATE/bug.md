---
name: Bug report
about: Something in Emerald does not work as it should
title: ''
labels: bug
---

**What you did**


**What you expected**


**What happened**


**The version**: run `emmer --version` in any terminal, or open the app menu under the mark at the left of the title row, where What's new carries the version.


**The arch**: Settings, System, About, "System type", or `$env:PROCESSOR_ARCHITECTURE` in PowerShell (`ARM64` or `AMD64`).


**Windows' version**: Settings, System, About, "Windows specifications".


**The logs**: attach `main.log` and `emmerd.log` from `%USERPROFILE%\.emerald\logs`. `hooks.jsonl` in the same folder records what your sessions did, prompt text and file paths included, so attach it only if you are happy to share that.
