# Emerald

Emerald is a Windows desktop app for running and supervising several Claude Code sessions at once: each session gets a pane, the sidebar shows which ones are working, waiting on you or done, and the `emmer` command drives them from any terminal. This repository holds the installers, this README and the issues; the code is private.

## Requirements

- Windows 10 or 11, on arm64 or x64.
- Git on the PATH.
- Claude Code on the PATH, so that `claude` runs in a terminal.

You do not need Node; the app carries its own.

## Install

Download the installer from the [latest release](https://github.com/zacharykeeton/emerald/releases/latest): `Emerald-setup-<version>-x64.exe` for most PCs, or `Emerald-setup-<version>-arm64.exe` for an Arm one (Settings, System, About, where "System type" says which). Run it.

The installer is not code-signed, so the first time you run it Windows SmartScreen says "Windows protected your PC": click **More info**, then **Run anyway**. Your browser may also warn that the file is not commonly downloaded; keep it.

It installs for your user alone, with no admin rights, to `%LOCALAPPDATA%\Programs\emerald`. It puts `emmer` on your PATH for terminals opened afterwards, and adds Emerald to the Start menu and the desktop.

## The first launch

A banner offers to install Emerald's hooks into Claude Code's `~/.claude/settings.json` (**Install** or **Not now**). The hooks are how the app sees what each Claude session is doing. The install also takes Claude Code's single `statusLine` slot with a small wrapper that reports the model and how full the context is to Emerald, then runs the status line you had before, so it still shows. `emmer hooks uninstall` puts both back.

## Updates

The app checks this repository's latest release at launch and every four hours. When there is a newer one, a badge at the right of the title row reads `0.1.N available`. Its first click downloads the installer and the badge reads `Restart to install`; the second closes the window, installs the update and opens it again.

## Uninstalling

Run `emmer hooks uninstall` first: it removes the hooks and restores your previous status line, which would otherwise point at a program that is no longer there. Then Settings, Apps, Installed apps, Emerald, Uninstall. `%USERPROFILE%\.emerald` is left in place; delete it for a clean slate.

## Reporting a bug

Open an issue with the **Bug report** template, and attach `main.log` (the window) and `emmerd.log` (the background service) from `%USERPROFILE%\.emerald\logs`. `hooks.jsonl` in the same folder records what your sessions did, prompt text and file paths included, so attach it only if you are happy to share that.

## Licence

See [LICENSE](LICENSE).
