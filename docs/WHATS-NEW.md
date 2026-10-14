# What's new in emerald

The notes the app opens after an install, newest batch first. Each section is one batch of fixes, written for someone who was not there: an opening line on the batch and whether the daemon needs a restart, then Highlights, the few changes worth trying first and how to try them, and Details, a paragraph for every other change you can see. Click a heading to fold or unfold its section; the older batches open folded. The longer record of every batch, with the measurements and the gotchas, is kept in the working repository and not published; this file is the short version, and the app's What's New tab shows it (Ctrl+Shift+P, then `what`, brings it back once it has been closed).

## Fixes 645 to 665, 2026-10-14

Twenty-one fixes, most of them your asks from the last week: a web page in a pane beside your shells, the empty pane's Shell tile picking which shell it starts, Reveal in Files, a pane dragged onto another layout tab, and mermaid diagrams drawn in rendered markdown. The rest are smaller: the pane menu's colours named by what they change, a folder path's Ctrl+click, the row's activity line on the shade, the editor's pop-ups on the Emerald skin, a Claude in a cmd row let go when cmd's prompt comes back, and the code itself now under the MIT licence. The daemon goes to level 62, since it now keeps a browser pane in a layout and lets go of a Claude in a cmd row; the update stops the old daemon with your screens kept and starts the new one, and every pane comes back by Resume.

### Highlights

**A web page in a pane.** An empty pane has a Web page button beside its tiles: it opens a browser pane with an address bar, Back, Forward and Reload, and the page you type. `emmer open http://localhost:3000` from a shell opens the page in a pane too. A link the page opens in a new window goes to your own browser, and a terminal's Ctrl+click on a link still does. The page loads again when its pane is split or moved.

**Pick the shell from the tile.** The empty pane's Shell tile has a caret: click it to choose which installed shell the tile starts, PowerShell, Git Bash or Command Prompt, and the tile remembers the pick while that shell is installed. The palette (Ctrl+Shift+P, then `>`) starts any installed shell by name as well.

**Reveal in Files.** A file tab's right-click and a file pane's menu have Reveal in Files after Reveal in Explorer: the Files rail opens on the file's row with its folders open, scrolls to it and flashes it once, or says `Not in the Files rail` when the file is outside it.

**Drag a pane to another tab.** Drag a pane's title, or a session's row in the sidebar, onto another layout tab and it lands there at the far right; drop it on the + and it gets a new tab of its own. The window stays on the tab you dragged from.

**Mermaid diagrams.** A `mermaid` fence in a rendered markdown file is drawn as its diagram, with a Code | Diagram toggle on each block that the app remembers while it runs. A `.mmd` file opens rendered. A block that does not parse shows its code and the error.

### Details

**Terminal colours.** The pane menu's colour section is now Terminal colours, with a row for This session and a row for The window, each opening its own list of schemes, so it says which one a pick changes.

**Ctrl+click on a path.** Ctrl+click on a folder path in a pane opens it in Explorer, and Ctrl+Shift+click on a file path shows the file selected in its folder.

**The activity line on the shade.** A row's shade shows the row's own activity line under its state word, and each agent's box shows its latest tool call; the sidebar's team line carries each member's phrase.

**The editor's pop-ups on the skin.** Under the Emerald skin the editor's suggestion box, find widget, hover and find highlights wear the skin's colours rather than the editor's stock grey and blue.

**A Claude in a cmd row.** When Claude exits in a Command Prompt row and cmd's prompt comes back, the row goes back to being a shell rather than staying a Claude row.

**A failed download.** If a newer build's download fails in the background, the badge reads `Retry <version>`; click it to try again.

**MIT.** Emerald's code is under the MIT licence, with the licences of the packages it ships listed beside it.

## Fixes 620 to 644, 2026-10-10

Twenty-five fixes, most of them your asks from the last week: New shell offers Git Bash and cmd beside PowerShell, a newer build downloads on its own and one click restarts into it, the Emerald skin is the default, the activity view keeps months of history in less room, and a dictation from Wispr Flow pastes into a pane. The rest are smaller: the marks re-measured, a layout tab's mark that says Claude or shell, word suggestions on a solid ground, a pause for an animated picture, and tidy-ups to the uninstaller and the test harness. The daemon goes to level 61, since it now finds the installed shells and starts the one you pick; the update stops the old daemon with your screens kept and starts the new one, and every pane comes back by Resume.

### Highlights

**Other shells.** New shell still starts PowerShell, the first shell found. To start another, use `Other shell here` on a pane's right-click menu or on a folder heading's + menu: it lists Windows PowerShell, Git Bash and Command Prompt when they are installed. A Git Bash row reports its folder and its commands as a PowerShell row does, running and then ok or failed; a cmd row reports its folder but not its commands. A resumed shell comes back as the same shell, and `emmer shell --shell gitbash` (or `pwsh`, `powershell`, `cmd`) does the same from the command line.

**Updates in one click.** From the next release on, a newer build downloads in the background with nothing to click, and the badge at the right of the title row reads `Restart to update` once it is ready. One click closes the window, installs it and opens it again. If the download fails, the badge reads `<version> available` and a click tries again. This update itself still took the old two clicks, since the build you had was the one that ran them.

**Emerald by default.** A fresh window opens on the Emerald skin, existing installs that never picked a skin included; Classic is one click away on the app menu.

**Dictation pastes.** A Ctrl+V that arrives with no key code, which is how Wispr Flow's dictation sends its paste, now pastes into a pane as a typed Ctrl+V does.

**More history, less room.** The hook log's older files keep only what the activity view reads, about a fifth of their old size, and up to 192 MB of them are kept rather than three files, so the activity view reaches back months. A full-size older file found at a start is slimmed in place once, which makes a backup copied into `~/.emerald/logs` as the oldest file history again.

### Details

**Marks.** The Emerald mark sits about 2px higher in a pane's title, a tab and a sidebar row, centred on its text's whole word at 100, 125 and 150 percent. A layout tab's mark now says what the tab holds: the Claude mark when it holds a Claude session, the shell mark when it holds only shells, and either one moving when anything in it is working or running.

**Word suggestions.** Typing in a code or JSON file offers the file's own words in a suggestion box on the editor's own ground under both skins. In a markdown or plain text file the box no longer opens as you type; Ctrl+Space still opens it.

**Find and the keyboard in rendered views.** Ctrl+F in a rendered file now finds a match that runs across bold, italic, code or a link's edge as one hit. A transcript's Turns view takes the keyboard when it opens, as a rendered markdown does, so Ctrl+F works at once.

**Pause a GIF.** A `.gif` or `.webp` tab has a Pause button in its header that holds the picture on a still frame, and Play runs it again; the click to zoom still works on it.

**The uninstaller takes the hooks out.** Removing Emerald in Settings now also takes its hooks out of Claude Code's settings and puts your previous status line back. An update leaves them in. An Emerald older than this one leaves them behind, so there run `emmer hooks uninstall` first.

**A steadier start.** A window that has just started the daemon waits for the daemon's record before it says hello, so the first connection is no longer refused and retried; a retry, when one happens, says why in the window's log.

## Fixes 608 to 619, 2026-10-07

Twelve fixes: Emerald gets ready to go public, with updates from GitHub releases, a licence and a short README for a person who installs, and beside that four asks from the last week: an image shown as the picture in its tab, arrows on the tab strip, Delete on the Files rail, and Ctrl+F in a rendered file. The daemon goes to level 60, since every client now shows a token when it connects; the update stops the old daemon with your screens kept and starts the new one, and every pane comes back by Resume.

### Highlights

**Images in a tab.** Open a `.png`, `.jpg`, `.gif`, `.webp`, `.bmp`, `.ico` or `.svg` from the Files rail and the tab shows the picture, scaled down to fit, with its size in the header. A click shows it at actual size with scrolling, and another fits it again; a rewrite on disk shows within a second. An SVG also has Raw, as a markdown file does.

**Arrows on the tab strip.** When the tabs do not fit, an arrow sits beside each faded edge, lit only on a side that hides something. A click pages the strip so the tab the edge cut shows whole; hold it and it keeps paging. The back and forward chevrons and the `+` now stay put while the tabs scroll.

**Delete on the Files rail.** A file's or folder's right-click menu ends with Delete, wherever Rename is. The first click asks `Delete, to the recycle bin?` and the second moves it there and closes its tabs. It is greyed, with the reason on the item, for a file with unsaved edits, a folder holding one, and a folder a session works in. Rename also works now from a names search hit and from a row of the Changed list.

**Find in a rendered file.** Ctrl+F, or Find on a file tab's right-click menu, opens a find bar over a rendered markdown file or a transcript's turns: the hits marked in place, Enter steps to the next, Escape closes it. In Raw and Pretty it opens the editor's own find, as before.

### Details

**Updates from GitHub.** An install checks the releases at github.com/zacharykeeton/emerald for updates. A PC that publishes its own local feed (`%LOCALAPPDATA%\emerald-feed`), which is this one, keeps checking it as before; the window's log says which it checks.

**A licence and a README.** The README is now a page for someone who installs: requirements, install, first launch, updates, uninstall, building from source and reporting a bug. Everything it used to hold is in `docs/HANDBOOK.md`. The licence lets you install and run the released builds; it does not allow redistribution or changes.

**A token on the pipe.** The daemon writes a token into `~/.emerald/daemon.json`, and the window, `emmer` and the tests show it when they connect; a connection without it is refused. A client from before this update cannot talk to the new daemon, so update the window and the command line together, which the installer does.

**Tidier hooks.** `emmer hooks install` no longer looks for the old zorca home's hook or the old `claude-hook.js`, and an install that would only reorder keys in Claude Code's settings now reports no change and writes nothing.

**Release and export tools.** `npm run release -w @emerald/app` builds both installers and drafts the GitHub release, and `node scripts/export-public.mjs` builds the fresh repository for the code's first push, with a scan for secrets. Neither runs on its own; both are yours to start.

## Fixes 588 to 607, 2026-10-01

Twenty fixes: a menu for the Files rail's own folder, the Activity graph on a folder with no repository, the Emerald mark sitting on its line, the app icon at full size, the hooks banner that follows Claude's settings with a Test, and the activity view saying how far back its history goes; beside them, the test suite no longer posts to your own daemon, and three verify reads and a stage rule are tightened. The daemon goes to level 59; the update stops the old daemon with your screens kept and starts the new one, and every pane comes back by Resume.

### Highlights

**A menu for the rail's own folder.** Right-click the folder's name in the Files rail's header, or the blank space below the last row, and the folder's menu opens: New file, New folder, Find in folder, Open in Explorer, Reveal in Explorer, Copy path and Insert path into pane; a row keeps its own menu. A folder with nothing in it says `Empty folder` in muted text instead of showing a blank list.

**The Activity graph on a folder with no repository.** A Claude started in a folder that is not a git repository, or a shell started there, now shows that folder in the Activity tab: `Not a git repository`, with Init. A Claude that steps out of a repository mid-session still keeps the repository's graph, as it has since fix 114.

**The Emerald mark sits on its line.** Under the Emerald skin the gem beside a pane title, a sidebar row and a tab sat about two pixels high; it now sits on its text's line at 100, 125 and 150 percent.

**The icon at full size.** The app's icon is the flush gem filling its cell, with no sparkle, so it stands as tall on the taskbar as its neighbours. Windows keeps an old icon in a cache for a while, so the taskbar may show the old one until it lets go.

**The hooks banner follows Claude's settings, and has a Test.** The banner rises the moment something removes emerald's hooks from Claude Code's settings and falls when they come back, without a restart. Its Test button sends one event through the installed hook to the daemon and says whether it arrived (`Test passed: the hook reached emerald.`); `emmer hooks status --test` does the same from a terminal. When another program keeps rewriting the settings, the banner says so instead of offering Install again.

### Details

**History from.** The activity view has one muted line under its header, `history from Sep 21`, the oldest moment the daemon's activity log still holds, and `emmer activity` prints the same date.

**Escape stops at a menu.** An Escape that closes a menu no longer goes on to the terminal or editor under it, so a half-typed line survives it.

**A file pane follows a rename.** Renaming a file in the Files rail moves a pane showing that file to its new path, unsaved edits included (the undo history starts fresh).

**Tidier tests and tools.** The CLI suite's status line runs post to a private home and never to your own daemon; the status line's unhosted post has its own script and the old `claude-hook.js` is gone; the stage ships only what runs; a verify launch sweeps fixture folders a dead run left behind; and `verify:m9` takes `-- --only <block>`.

## Fixes 569 to 587, 2026-10-01

Nineteen fixes: a second skin, Emerald, behind one menu item, and small asks beside it in the files rail, the empty pane, the show chooser, the hooks and the CLI. The daemon goes to level 58; the update stops the old daemon with your screens kept and starts the new one, and every pane comes back by Resume.

### Highlights

**Skin: Emerald.** The app menu (the Z at the top left) has a new item, `Skin: Classic` / `Skin: Emerald`. Classic is the default and looks as it did. Emerald changes every colour of the window at once, from the title bar's first frame on: a working Claude's mark cycles ◇ ◈ ◆ and rests at ✦, every other star the window draws for Claude becomes that ✦, the menu button becomes a gem that glints now and then while the sidebar is folded and a session works, and the terminal and editor wear the new `emerald gem` scheme unless you picked one by hand. Flip back the same way; a scheme you picked stays picked under both.

**The gem icon.** The app's icon is a gem now, under both skins. Windows keeps an exe's old icon in a cache for a while, so the taskbar may show the Z until it lets go.

**Rename from the Files rail.** A file's right-click menu has Rename after Open in a tab, and a folder's menu opens with it. F2 renames the selected row once the tree has the keyboard: right-click a row, or click a file that is already selected. A taken name keeps the box open, and a file open in a tab follows to its new name, unsaved edits and all.

### Details

**A double-click on an empty pane's folder row starts there.** It starts the chosen kind in that folder at once, as a digit does. An Escape now reaches only the empty pane it was pressed in, and at 320 px a session row keeps its kind whole.

**Open in a new tab.** The show chooser (and a sidebar row's menu) has `Open in a new tab`, right under Open beside: the session opens on a layout tab of its own, named after its folder heading. Remember my choice never remembers this one.

**The hooks banner fits one line.** Its hint is shorter: `Install edits Claude Code's settings so new sessions report their state.`

**A Claude outside emerald reports through curl.** The hook of a Claude started in another terminal posts with `curl` and the daemon's `daemon.json`, with no node started, about 80 ms a post where node took 170.

**`emmer open` says when nothing answered.** When the window gets the file but does not answer within 3 s, the command says `sent to the window; it did not answer within 3 s` and exits 75; `--json` carries `answered`.

**Tidier tests.** The unit suites remove every temp folder they make, and `verify:context` runs in a fixture repository of its own, so a long branch name no longer fails it.

## Fixes 542 to 568, 2026-09-29

zorca is now Emerald: the app and its Start menu entry are Emerald, the command is `emmer` (`emmer ls`, `emmer hooks install`), the daemon is `emmerd`, the home is `~/.emerald` and every variable is `EMERALD_*`; your sessions, layout and hooks moved over once, and the old `%LOCALAPPDATA%\zorca-feed`, `%LOCALAPPDATA%\zorca-updater` and `%APPDATA%\zorca` folders are yours to delete.

Twenty-seven fixes: the rename, an empty pane that asks what kind and which folder, and small ones in the daemon, the files rail, the Commits tab's git poll and the menus. This install was a one-time move by a script rather than the badge, and the new daemon started with it; the window's own settings (the colour scheme you picked, folded sections, open tabs) start fresh once, since the new app keeps them in a profile of its own.

### Highlights

**The empty pane asks what kind, then which folder.** An empty pane now shows two tiles, Shell and Claude session, over a numbered list of folders: the folder the pane was split from first, then the ones you used last. A bare Enter starts the chosen kind in the chosen folder, Tab flips the kind, a digit starts it in that row at once, and Another folder… opens the folder picker. Claude session's More… opens the full dialog for arguments and a first prompt. The kind you last started is the default next time. Type in the box below to show a running session there instead, as before; while you type, the list dims and Enter shows the highlighted session. Split any pane with Ctrl+Shift+E and press Enter to try it.

**Ctrl+J lists first, then offers a start beside.** The overlay over a running pane shows its sessions first, with `⏎ here` on the highlighted row, and at the bottom one line: Or start one beside, in `<folder>`, with a Shell button and a Claude session… button that opens the dialog for a session beside the pane.

**`emmer hooks install` follows `CLAUDE_CONFIG_DIR`.** When that variable is set, the hooks, the status line and the skill go into its `settings.json`, which is where Claude Code reads them.

### Details

**Menus draw headings as headings.** "Colour scheme", "Shade after idle" and "By default" are drawn as section headings in the pane, split and file menus, not as greyed-out items.

**Name boxes stop at the daemon's lengths.** A session's name, its checkpoint, a folder label and a saved prompt's name stop taking text at the length the daemon keeps; a longer paste is cut.

**`emmer daemon status` names a set-aside file.** When a store file could not be read and was moved aside, status prints `set aside: <name>` for it, with the daemon up or down.

**Quieter in the background.** A write inside a folder the files rail has open no longer relists it (only a new, renamed or removed name does); the Commits tab's poll runs two gits a tick where it ran five, reading the author and the worktree list only when they can have changed; a session with no history line counts its prompts off what the transcript appended; and `main.log` is moved aside to `main.1.log` past 8 MB at a start.

**Small repairs.** A repository in git's newer reftable format shows its branch name rather than `.invalid`; a hook log rotation over a generation another program holds open leaves every generation as it was; the feed serves only its manifest, installers and blockmaps; and an `emmer open` sent as the View menu's Reload begins is held and opened after the reload; and Escape in an empty pane's action box always empties it.

## Fixes 494 to 541, 2026-09-29

Forty-eight fixes: the second half of the hardening pass (the pipe, the terminals, the session records, the load sampler, the files rail and the editor's save), a working line that no longer costs the window a repaint per agent, a split that gives an empty pane, and a right-click in a Claude pane that pastes once. The daemon restarts as part of the update; it now listens on a pipe named for you (`\\.\pipe\zorcad-<user>`), so a script of your own that names `\\.\pipe\zorcad` sets `ZORCA_PIPE` or goes through `zorca`.

### Highlights

**A split gives an empty pane.** The split buttons on a pane's title bar, and the pane menu's Split items, now give an empty pane with its filter box focused, as the Ctrl+B chords always did: type a few letters to show a session there, or start a shell or a Claude from it. Right-click either split button for Split empty, Split with shell or Split with Claude for one split, and under By default pick what a plain click gives from then on.

**A right-click in a Claude pane pastes once.** Claude Code takes the mouse, so a right-click there used to reach it as well as zorca and paste twice. The right button's press and release now stop at zorca, so a right-click copies the selection or pastes once in every pane, and the pane menu opens as before.

**The working line is cheap to draw.** The band of light that travels along a working session's line moves on the graphics card now rather than being repainted each frame, so a dozen agents at work no longer slows typing. Look at a working row in the sidebar or a working lane in the Activity tab: the light should still sweep left to right.

**A save does not overwrite a change on disk.** If a file changed on disk since you opened it (another program, a Claude, a `git checkout`), Ctrl+S stops and shows the changed-on-disk line instead of writing over it, so you choose. A save also keeps a hard link or a symbolic link pointing where it did rather than replacing it with a plain file.

**`zorca update --check` always answers.** A check made in the same minute as the last one, with the same answer, used to wait thirty seconds and fail; it prints the answer now. `zorca update` with no window open exits 69 with the same words as `zorca open`, and `zorca explain` reads the hook log backward from the newest line, so it answers at once on a big log (`--all` reads every kept file for the exact total).

### Details

**The daemon you started is the one that stops.** A restart or `zorca daemon stop` kills only the daemon it said hello to, checked by the process's start time, never a process that took over a recycled number. The pipe is named per Windows user and per home, and a window that meets another home's daemon says so in a banner. The first autostart retry waits three seconds, a client that stops reading is dropped at 32 MB rather than holding the daemon's memory, a paste past a megabyte goes over in pieces, and `zorcad.log` keeps one old generation past 8 MB.

**Terminals are bounded.** A title or folder escape that never ends can no longer swallow screenfuls of output, a pane cannot ask for a terminal larger than 1000 by 1000, an exited session's hidden terminal is freed at exit (its last screen is kept for `zorca read`), the live reply under a row decodes a character split across two reads, and a Claude installed by npm runs as node rather than under `cmd.exe`. Your PowerShell profile's own Enter handler, if it has one, still runs after zorca's.

**Session records hold their shape.** A hook that lands after a session exited puts nothing back on its row, a subagent's hook refreshes its parent's clock, a malformed session id is refused, and a record's spans, tasks and team, a session's name, its checkpoint, a scheme's name and a saved prompt all have a length limit. A hook body past a megabyte is still read for its head fields.

**The load meter and the clock.** A recycled parent process id pulls nothing into a session's load, a hung sampler child is restarted, the process tree is walked once per sample, the pipe answers before the activity log has finished loading (a faster start on a big log), and the Activity view's hour and minute units step through the autumn clock change, the repeated hour marked as such.

**The files rail.** A contents search you moved on from is stopped, a folder of tens of thousands of files lists several times faster, a folder heading's icon is re-read after a minute, zorca honours `CLAUDE_CONFIG_DIR` wherever it reads Claude's home, the rail's root stays watched in a very big tree, and a second drag of a file out of a folder keeps the first one's row. A `zorca open` sent while the window reloads is held and opened after it.

**Transcripts are read as they grow.** The agents beat, the commit card and the History tab read only what a conversation appended since the last read, not the whole file again.

## Fixes 450 to 493, 2026-09-28

Forty-four fixes, most of them from the first hardening pass: the places where zorca could lose a file, a claim or its daemon when something went wrong underneath it, plus the file editor's usual keys, a quieter shaded lid and Copy on select moved onto the pane menu. The daemon restarts as part of the update; no banner asks for it.

### Highlights

**The file editor's usual keys.** Ctrl+Left and Ctrl+Right jump by word in a file tab, from the first file you open (before, only after a `.json` file had been opened), and the rest of the editing set you would expect from VS Code works there too: Alt+Up and Down move a line, Ctrl+Shift+K deletes one, Ctrl+/ toggles a comment, and Ctrl+D and Alt+click add cursors. Ctrl+S saves the file you are looking at, whichever pane or tab has the keyboard, every time.

**A preview tab stays when you want it.** Double-click a preview tab (the italic one a single click in the files rail opens) to keep it, or just start typing in it: an edit keeps it too, so a second click in the rail no longer replaces a file you have changed.

**The shaded lid says `done` once.** A shaded pane whose session finished shows the seconds since in the done colour without the word beside it, and its team line reads `worked alone` rather than `working alone`.

**Copy on select is on the pane menu.** The setting that copies a shell selection as you release the mouse moved from the shade button's menu to every pane's right-click menu, just above Colour scheme.

### Details

**A daemon that dies at start is started again.** If the window's daemon fails to come up it is started again on a backoff and the window says it is reconnecting rather than sitting on an empty layout; the reason is in `main.log`. A second daemon started by a race no longer empties the hook log before it gives way.

**Your sessions survive a bad write.** The session, layout, folder and prompt stores are written through a temp file, a store file that cannot be read is set aside beside it as `<name>.bad-<time>` instead of being overwritten with nothing, and a save refused by a busy file is retried. A session whose name or colour was stored oddly keeps the session and drops only the odd field.

**Prices and times on the activity view hold up better.** A conversation run outside zorca that goes quiet for an hour leaves the list, a turn cut off by a daemon restart ends at its last line rather than running on, a clock set back no longer draws a negative span, a resumed conversation is priced from its first request, and Opus 4.8 is priced.

**Commits are credited more carefully.** A branch switch, a fast-forward or a merge that brings in older commits credits nothing to the session that ran it, and a commit another session already holds is not taken by a long command that happened to span it.

**Revert, the review tab and the conflict forecast.** Revert on a file whose name has a `*` or `[` in it reverts that file alone; an untracked file's line count in the review tab is capped and no longer stalls the window; a conflicted path with a non-ASCII character is shown as written.

**Links open in your browser.** A link that would have opened an Electron window (a Ctrl+click on a URL in the editor, a middle-click on a link in a markdown file) opens in the browser instead, and a markdown image that points at another machine's share is not fetched.

**Notifications stay clickable.** A toast could stop answering its click after a while; it is kept until you click or close it.

**The files rail follows a deleted folder.** A folder the rail, the commits view or the history is watching can be deleted and made again without the watch going dead, and a repository's `index.html` cannot point the sidebar's icon outside its folder. A file that grows past the size cap while it is read is refused, and a save refused because another program has the file open says so.

**The Changed list shows the right status.** A file whose status changed while its line counts did not (staged to modified, say) now shows the new status.

**The update feed.** A bad request to the feed no longer stops the daemon, a publish writes through a temp file, and a daemon that found the feed's port taken tries again every two minutes.

**Hooks outside zorca.** A Claude run outside zorca with no daemon up no longer starts node on every hook, and zorca's own hook entries written with backslashes, or in a settings file with a byte order mark, are recognised and installed.

**An x64 installer on demand.** `npm run dist -w @zorca/app -- --x64` builds an x64 installer into `packages/app/release-x64` beside the usual arm64 build, for handing zorca to someone on an Intel or AMD machine.

## Fixes 426 to 449, 2026-09-26

Twenty-four fixes from one Saturday batch, run unattended while you were away: copying out of a shell pane at last, wider usage bars, a done row on the shaded lid, a file's own scheme colouring its syntax, a content hit dropped on a pane opening at its line, the tasks card saying whose each task is, the agent card with room for a long command, Opus 5.5 priced and named, and a flash on the pane New shell here makes. Behind them, the daemon's hook log now rotates while it runs and `zorca explain` reads all of it, and the test harness can run one block of its two longest scripts. The daemon's feature level stays 56, so no restart is asked beyond the install's own.

### Highlights

**Copy out of a shell pane.** Select text in any pane and press Ctrl+Shift+C, or right-click: a right-click with a selection copies it (and clears it, so a second right-click pastes), and a right-click with nothing selected pastes. Ctrl+C still sends ^C to the program, as it always did. If you would rather copy the moment you let go of a drag, turn on **Copy on select** on the shade button's menu in a pane's title; it is off by default. In a program that takes the mouse (a TUI with mouse reporting on), Shift+drag selects.

**The usage bars use the room they have.** In the sidebar's column form (5h, 7d and a model window one per line) each bar now grows into the space its row used to leave empty, and goes a little taller once it is past 88 px, so the fill and the pace mark read without leaning in. The ticks space themselves against the bar as drawn. The row form, with the windows on one line, keeps its 44 px bars, and which form the strip picks is unchanged.

**A shaded pane says when it is done.** Shade a pane, let its session finish in the background, and the lid shows a done row of its own, the seconds since in the done colour with the same hush button the waiting row has, instead of saying `done` only in its heading. It goes when you acknowledge the pane.

**A file's scheme colours its syntax too.** Giving a file its own colour scheme from the file menu used to change its background and plain text while strings, numbers and keys kept the dark theme's colours. They take the scheme's own now: strings its green, numbers its magenta, keywords and JSON keys its blue, comments its bright black. It matters most for a light scheme from your Windows Terminal settings, which used to leave dark-theme colours on a white page.

### Details

**A content hit dropped on a pane opens at its line.** Dragging a hit out of the files rail's contents search onto a pane opened the file at the top. It opens at the hit's line now, with the same whole-line flash a click on the hit gives in a tab.

**The rail's lift keeps the folder it came from.** In a folder with more than 2000 subfolders the rail lists the first 2000, and the up button could lift you into a listing that did not hold the folder you came from. The folder you lifted out of is kept in the listing, in its sorted place and open, and the `more not shown` note counts the rest.

**The History panel keeps the groups you opened across a reload.** A group opened by hand stays open after a reload while the same session is focused; focusing another session puts the folds back to the usual shape.

**The tasks card says whose each task is.** The checklist card on a session with subagents listed every task flat, the session's own mixed with each member's. The session's own come first, then each member's under its name, the same name its box on the lid uses.

**Room on the agent card.** Hovering a working subagent's row used to cut its command and session line at the card's fixed width. The card widens to fit, up to 320 px, and past that the lines wrap, up to three.

**Opus 5.5 is named and priced.** The rail's agent rows, the cards and the prices had no Opus 5.5 row, so an Opus 5.5 session or subagent showed no model word and no `~$` on its tokens. It has one now, at $4 and $20 per million. A model of a known family with a number the table does not know yet shows its family word alone and no price, rather than nothing.

**New shell here beside a view, with a flash.** New shell here (and Ctrl+Shift+N) over a view pane, such as a commits view, used to replace the view; it splits beside it now, as the sidebar's buttons already did, and the new shell starts in the view's folder. The empty sidebar's New shell takes the focused pane's folder. A pane made this way flashes once, the same ring focus gives, so you can see where it went.

**The context card's token line is named for what it holds.** The line that reads `sent N, received N` on the context card was called by a name that suggested dollars; it is `token totals` now, and the note that the dollars are an estimate sits on the line with the dollars.

**The hook log rotates while the daemon runs.** The daemon rotated `hooks.jsonl` only when it started, so a daemon left up for weeks grew the file without bound. It checks once an hour now and rotates past 64 MB without a restart.

**`zorca explain` reads the whole hook history.** It read only the newest two files, whole, and on a box with a large rotated file it failed outright with a stack overflow. It streams every generation the daemon keeps, parsing only the lines for the session asked about, and the `of N` total counts them all.

**The CLI's last two hellos have the deadline.** `zorca open` and `zorca update` now give up on a daemon that never answers, with the same one line every other command gives. `zorca open --beside` and `zorca focus` name the pane by its first eight characters, as sessions are named; `--json` keeps the full id.

**The install check reads the gap toast.** `install-check` now says whether the toast shown by a launch during an install was posted and shown, and reads each poster's log against the install it is checking, so an old line from an earlier install no longer reads as this one's.

## Fixes 394 to 425, 2026-09-22

Thirty-two fixes from one morning batch: the tail of the shade lid the last batch was cut at, with a checklist strip per subagent and the waiting counter moved onto the lid's own face; cents on every price in the window; two reads the commit graph had wrong; three checks that could not say no, now able to; the install path's toast and the two reads that judge it; the daemon's hook log kept three generations deep and its exit reaper taught not to kill a stranger; and a dozen small renderer asks. The tenth build to arrive through the updater. The daemon's feature level is 56, up from 55, so a window on the previous daemon shows the banner and offers Restart zorcad; take it (the daemon restarts with the install anyway, since the installer stops it).

### Highlights

**Every subagent on the lid carries its own checklist.** Shade a pane whose session has subagents out and each member's box on the lid now has a 2 px strip under its name and price, one segment per task on that member's own list, lit as the session's own rule is; hover the strip and that member's checklist opens. A member with no list has no strip. The daemon reads the owner off the `agent_id` every tool hook carries, so a task a subagent made is attributed to it rather than pooled into the parent's list; the session's own counts, its row, its title and `zorca ls` go on counting every task whatever its owner. Level 56.

**The waiting counter is part of the lid now.** A shaded pane at needs-input used to draw the big 48 px counter and its hush button over the lid's top right corner, where on a narrow pane it met the hero's name. The counter and the hush button are part of the lid's face now, beside the wait line, and there is one clock behind them rather than two a second apart. An unshaded pane keeps the overlay exactly as it was. Shade a pane that is waiting on you, in a narrow split, to see it.

**Dollars and cents everywhere.** Every price in the window was whole dollars past ten and cents below, so a lid saying `$61` meant 61.20 and a row saying `$125` meant anything from 125.00 to 125.99. Every figure is `$125.88` now, through the one formatter: the lid's spend and its per-member prices, the sidebar row, the pane title, the commit card and the block summary, the context card, the history row, the running-agents line, the sweep cards and the activity stats.

**The app's typecheck runs green, and it earned its keep the day it landed.** `npm run typecheck -w @zorca/app` had never passed: its first project swept every renderer test and model into a compiler with no DOM, so it failed with 181 errors and nothing ran it. It is three projects now, one for the main process and preload, one for the renderer, one for the renderer's tests, and all three pass. At this batch's own merge it caught two things no branch could have seen on its own: a hand-written typings file two fixes had outgrown, and a test indexing an array under a rule its project had never been checked by.

### Details

**A commit made before Claude started sits on the record's own line.** A commit the shell claimed before any conversation opened was drawn inside the first conversation's block, so after a `/clear` it appeared to belong to a conversation that did not exist when it was made. It sits on the record's own live block now, below the start bar, which reads as what it is: before Claude. The start bar stays where it is and the block's line runs past it.

**The cards price a working session as it works.** The context card and the agent card asked the usage figures once, keyed on the conversation, so a card opened on a session that then kept working never asked again and went on showing the older cache-write split. They follow the session now, re-asking when a hook moves it and asking nothing while it is quiet; the commit rows' own once-per-commit ask is unchanged.

**The sideways agent label says what a subagent is, not what it is doing.** The graph's sideways labels read `working · subagent · <name>` or `idle · subagent · <name>`, spending a word on a state the mark already shows by stepping. They read `subagent · fork · <name>` now, the same kind word the upright pill, the agent card and the write graph's author line already use.

**The lane card tells the two kinds of fork bar apart.** A bar on a lane can mean a fork landing on that line or a lane ending at the commit it came from, and the card folded both into one sentence. It draws a line for each now, landings first, when both are on the card.

**The CLI's hello has a deadline.** A daemon that accepted a connection and never answered held any `zorca` command for ever. The hello gives up after five seconds with `zorcad refused the connection: hello timed out after 5000 ms` and exit 1. `daemon status` and `daemon stop` now speak the same vocabulary as every other command: an absent daemon is still `zorcad is not running`, and a real failure is named rather than flattened into it.

**`zorca open --beside` says which pane it picked.** A session on several panes gave the command no way to say which one it opened beside. The usage and the summary say the rule (the pane on the tab in front, else the first in tab order) and the reply names the tab and the pane it chose; `--json` carries the pane id and the tab name. `zorca focus` says the same.

**The install-gap toast goes through a worker that outlives the installer.** The toast a launch during an install was meant to raise has never been seen, because the process raising it is the one the installer kills. It goes through the same detached worker shape the install poster uses, with files of its own so a gap launch never overwrites a poster still sleeping, and the app quits as soon as the worker is spawned rather than holding six seconds for a toast that was never going to show.

**The hook log keeps three rotated generations.** The daemon dropped the older generation whole at every rotation, so the history was whatever fit in 64 MB plus what had been written since. It keeps three now, up to 256 MB in four files, and the `activity log loaded` line counts each.

**The exit reaper knows which daemon it was sent for.** The daemon spawns a small process at exit to kill itself if node-pty hangs the shutdown, and one such was found alive thirteen hours later with its target long gone. Windows reuses process ids inside minutes, so a pending kill on a stale number can land on whatever took it. The reaper checks the target's start time against the one it was given and refuses if it differs, and its whole life is capped at thirty seconds.

**The History panel folds from every project, and keeps its folds.** With a search in the box narrowing the list to one project, collapsing and expanding the rail folded nothing and never tried again, so a window opened with text left in the search box folded nothing either. The folds are computed from the whole list now, and they survive a rail collapse the way the search text does.

**New shell here splits beside a live pane.** Ctrl+Shift+N, the pane menu's row and the empty pane's button all put the new shell over whatever the pane held, sending a live session back to the sidebar on no pane. When the pane holds a live session the shell is started in room made beside it, in the pane's folder; an empty pane or a view pane is still taken as it is.

**A file dropped on a pane's centre focuses that pane**, as a folder dropped there already did.

**Format the JSON selection.** `Format JSON selection` sits under `Format JSON` on a `.json` file's menu in the Raw view, disabled while nothing is selected; the header's Format button stays whole-file.

**The editor logs no errors on the first file open.** Opening a file used to write five uncaught `depends on UNKNOWN service` lines to the log, from editor contributions whose services are registered too late by Monaco's own lazily-loaded language workers. The app imports those modules itself, early, so the registrations land in time; Ctrl+F's find widget, bracket matching and word highlight came with them, and none of them worked before.

**A path wrapped across two terminal rows is one link.** A path long enough to wrap at the pane's edge was two half tokens, neither of them a link. The rows are joined before the paths are found, so the whole path is one link hovered from either row. A library's line in the app's log is marked `[lib]` so it can be told from zorca's own, and the hover's file check is remembered for five seconds rather than asking the main process on every pointer entry.

## Fixes 372 to 393, 2026-09-21

Twenty-two fixes from one evening batch: the two visuals the design passes decided (the shade as a lid, and the subagent row that read as an agent from nowhere), two forms of `zorca open` a Claude in a pane asked for, the daemon's start on a 489 MB hook log, the CLI's and the window's silent pipe failures, three misses from the last install (the installer's Open with entries, the updater's half-swept folder, the poster that never ran), a file dropped on an empty pane, the file header at a narrow width, a Reset text size item, and three verify-script smalls. The ninth build to arrive through the updater. The daemon's feature level is 55, up from 54, so a window on the previous daemon shows the banner and offers Restart zorcad; take it (the daemon restarts with the install anyway, since the installer stops it).

### Highlights

**The shade is a lid.** Shade a pane (the button on its title, `Shade all` on the tab menu) and the face is one hero and a team: the session's mark on a line of its own at a size the pane's width picks, the name stepped by its length and split at a colon or a leading id token into an identity line and a subject line, the state word, the spend large over `at API rates, subagents included`, and one small line for the context dial, sent, received, cached and the age. The session's checklist is the rule between the hero and the team, one segment per task with `1 of 3 tasks` above it and the list on hover (a plain line when there is no list). Under it one box per subagent in a grid, each its mark, its name, its state, its kind after the model word (`fork`, or the agent's own type, the same word the sidebar's team list wears) and its own price; `working alone` when there are none; a narrow pane shows four boxes and `and N more`. The roster units line and the member list are gone. Shade a session with a few subagents out to see it; a wide pane and a sliver give the two ends.

**A commit-less subagent sits beside its parent.** A subagent with no commit of its own used to take a lane past every other, its dashed fork a straight line along the row's bottom across every lane between, landing on the parent's bare line with no mark. Now its lane is the one right after its parent's line, so the fork is a short bend, and a bar marks where the fork lands on the parent's line. The rail's agent card and the write graph's author line say the subagent's kind in the role pill: `subagent · fork`.

**`zorca open` takes a scheme and a place.** `zorca open <file> --scheme <name>` opens the file with the named colour scheme as its own pick (the same pick the file menu offers), `--clear-scheme` puts the window's back, and an unknown name is kept as the pick with no colour and one line on stdout saying so. `zorca open <file> --beside <session>` puts the file beside that session's pane on that pane's tab, whichever tab is in front; a bare `--beside` from inside a pane means the session the command runs in; a session on no pane falls back to the focused pane and says so. Level 55; a run with either flag on an older daemon is refused with the usual line.

**The daemon starts fast on a big hook log.** The hooks every Claude posts are written trimmed (a tool's input and response cut to their first kilobyte with a `truncated` mark, a status line reduced to what the activity reads; `ZORCA_HOOKS_FULL=1` keeps whole payloads), the log is rotated to `hooks.1.jsonl` past 64 MB at the daemon's start, and the load streams both files line by line rather than reading the whole into memory; the `activity log loaded` line says the two files' line counts and the milliseconds. On a 489 MB log the last install's daemon took five seconds to answer; read the line at this one.

### Details

**A fresh shell's first conversation starts when Claude does.** A shell opened at nine whose person typed `claude` at eleven had its first conversation span drawn from nine, so every commit made in the shell before Claude existed sat inside the conversation's block on the graph. The span opens at Claude's `SessionStart` now, and its start commit is the folder's HEAD at that moment.

**No CLI command exits 1 in silence.** A pipe that drops mid-request settles the pending request with the error rather than throwing it out of a socket callback, an uncaught error is written as one `zorca: <message>` line on stderr, and a run about to exit 1 having printed nothing says `zorca: exiting 1 with nothing to say`, so the next occurrence names itself. The window's own pipe client destroys its socket on a write error and gives the hello five seconds, so a window that meets a dying daemon's pipe at a relaunch goes on to its reconnect instead of parking.

**The installer writes Open with entries and never the default.** The `.md` and `.json` registrations are written by the installer script itself: the ProgId, its icon and its open command, and an `OpenWithProgids` entry under each extension, never the extension's classic default, which the previous installer set and its uninstaller left dangling. The uninstall removes what it wrote and clears a classic default that names zorca, which repairs a box the earlier installer touched at its next uninstall. `verify:install -- --entries` reads a live install's files, PATH entry, ProgIds and defaults without touching it, and `npm run install:check` prints an install's first-launch record in one go (the installer run, the first launch's hooks install, the updater cache line, the poster, the daemon's start time, the stamps, the pending folder, the shipped What's New heading).

**The first launch finishes its sweep and shows its poster.** The updater's pending folder is swept file by file with the installer's exe first, read off the exe's own name when the info file is gone, behind the daemon's `connected` at every launch and once more five minutes on when the installer still holds the file (the last install left the 118 MB exe behind that way). The install poster runs from a detached node worker that runs PowerShell attached, so the toast's host has a console and outlives the app; `~/.zorca/install-poster.log` is the proof at this install. `verify:install` reads what the first launch's `zorca hooks install` wrote: every event's hook, the status line, the wrappers naming the packed exe, and `hooks status` complete through the shim.

**A file dropped on an empty pane opens there.** Over an empty pane a dragged file shows the same five zones a folder drop shows; the middle opens the file in that pane, an edge splits the pane and opens the file beside it. A file of an extension Windows has no registered type for (a `.md` on many boxes) lights both what a folder and what a file would take on the way in, and the drop opens it as before.

**The file header gives its parts up as the pane narrows.** The path's folder goes first (the file's name stays), then Open with Windows and Reveal (the right-click menu keeps them), then Wrap and Format together, then the name; Save while dirty, the Pretty/Raw switch and the close never give, so the close is never the first thing cut. Split a file pane down to a sliver to see the order.

**Reset text size, and Focus.** The pane menu has `Reset text size`, disabled at the default with `Already at 14 px`, the way back after the wheel enlarged a pane's text (Ctrl+0 still does it). The pane-alone feature is called Focus: `Focus` and `Unfocus` on the pane menu, `Focus, this pane alone in the tab` on the title button, `Focus pane` on the prefix `z` chord; the word zoom now means only Ctrl+wheel over a graph.

**Under the hood.** `verify:m9`'s roster-card hover waits for the layout to settle and tries twice; `verify:cli-claude`'s waits give a real Claude turn ninety seconds and its watchdog five minutes; `verify:history` reads the folds after a rail remount before opening them, and found the History fold effect narrowed by the search box at a remount (a backlog entry).

## Fixes 352 to 371, 2026-09-21

Twenty fixes from one midday batch, the performance batch: every performance entry the backlog held, which is the whole diagnosis of the typing lag of the morning of 2026-09-21, then the entries that fit beside them, the standing `/exit` miss among them. Run from a pane end to end and the eighth build to arrive through the updater. The daemon's feature level is 54, up from 53, so a window on the previous daemon shows the banner and offers Restart zorcad; take it (the daemon restarts with the install anyway, since the installer stops it).

### Highlights

**Typing no longer lags with the Timeline rail open.** The rail's commit graph asked the price of every conversation the records name on every five-second git poll, whether the log had changed or not, and each answer re-rendered its two hundred rows twice; with the rail on the Timeline tab the window's main thread sat at two thirds of a core in a five-second rhythm. Now the git poll hands the window nothing when the log, the status and the changes list are the same as last time; the usage store asks again only when a commit lands, publishes once per batch of answers and only on a change; each row remembers its slice and its price until its record or the store moves; the terminals' output rate goes to its own store so a pane's meter is the only thing that hears it; and every reader of the window's state names the fields it reads, so a push that changes one field renders only what reads it. `verify:graph` profiles the window for twelve seconds at the end of its run and prints the busy share with the frames that were busy.

**A file path in a pane is a link.** A path a pane prints (`packages/app/package.json:3`, `C:\Users\you\notes\lines.txt`, a relative one with a folder in it or a known extension, `:line` and `:column` allowed) underlines on hover with `Ctrl+click opens <path>` when the path is a file, resolved against the shell's folder, and Ctrl+click opens it in a pinned tab with the cursor on the line. A folder or a path that is not there says nothing and opens nothing.

**The usage card says how long a break puts a window back on pace.** Under a window whose runway is short (its pace runs out before the reset) the card adds `back on pace after a 2h 30m break`, the pause after which the average pace would reach the reset exactly; a window with room says nothing.

**A Claude that `/exit`s in a shell pane hands the pane back.** Since Claude Code 2.1.272 an interactive `/exit` posts no `SessionEnd`, so a shell that had run `claude` kept the Claude's name, title and transcript after the prompt came back, and the standing `verify:claude-resume` miss at every close-out was this. The daemon now reads the prompt's return as the leaving: a command that a hook of the still-open conversation landed in ends, and the row is a shell again the moment the prompt is back. A `SessionEnd` that does arrive still unbinds as before.

### Details

**The rail's folder name is the way back down.** After the up button lifts the tree above the folder it follows, the folder's name in the header is a button (`Back to the folder the rail follows`) that drops the lift; with no lift it looks as it did. The up button and the header name a drive root as a path (`Up to C:\`) rather than an empty name.

**The History search survives a rail collapse.** The History tab's search text is a setting now, kept with the rail's search mode and scope, so collapsing the rail and expanding it keeps the text in the box and the rows narrowed.

**The Pretty view rests while nobody is on it.** A `.json` file's Pretty view reformatted on every keystroke in Raw, two worker round trips over the whole file each time; now it holds its last text while no Pretty view is showing and reformats once, at once, when one comes back. Monaco's own context menu no longer shows under the app's file menu on a right-click in the editor.

**Tab smalls.** The panes tab's star steps in the idle tone while any subagent is out on an idle session, and stops when it returns; a new layout tab lands last on the strip on a fresh profile too, not only once the strip has an order of its own; and Ctrl+Shift+G opens a file through the same chooser as the app menu and the palette.

**Copy path everywhere goes through the app.** The tab strip's, the files rail's, the History panel's and the file header's Copy path all write through the app's own clipboard route, the one the sidebar's heading used already, so a copy works from any of them under any window state.

**A lost WebGL context is tried again.** A terminal whose WebGL context is lost (a GPU reset, a driver update, a long sleep) fell back to the DOM renderer for the pane's life; now it tries a new WebGL addon after 1 s, 2 s and 4 s and settles on the DOM renderer only after the third, each change a `terminal renderer:` line in the main log.

**The installed window can be profiled.** `ZORCA_INSPECT_PORT=<n>` in the environment puts the window's devtools server on that port, so the installed build can be attached over CDP the way a harness window is; the renderer's console warnings and errors reach the main log as `renderer: <level> <message>` lines, five a second at most.

**The updater's pending folder is swept.** The first launch of a new build removes `%LOCALAPPDATA%\zorca-updater\pending\` when the installer it holds is the one already installed (118 MB after every update), and says so in the main log; the cache root's installer and blockmap, which the next differential download reads, are never touched.

**Under the hood.** The demo skills and the shipped `zorca-cli` skill spell the checkpoint as the bare `zorca set --comment …`, and the daemon tests' folder teardowns retry for real (Node 24's `rmSync` ignores `maxRetries` on the `EPERM` a held folder gives).

## Fixes 329 to 351, 2026-09-20

Twenty-three fixes from one evening batch, run from a pane end to end and the seventh build to arrive through the updater; the first batch whose light fixes ran on the developer agent definition rather than a pasted brief. The daemon's feature level is 53, up from 52, so a window on the previous daemon shows the banner and offers Restart zorcad; take it, or `zorca open` answers `level 53 needed` until you do (the daemon restarts with the install anyway, since the installer stops it).

### Highlights

**A file opens from anywhere.** Open a file… on the app menu, the palette or prefix Shift+O opens the native chooser; a file dragged in from Explorer and dropped on the tab strip or the files rail opens too, the target lit while it hovers (a drop on a pane still types the path into it); `zorca open <path>` from any pane puts the file in the window, `--pane` beside the focused pane; and the installer registers zorca as an opener for `.md` and `.json`, so it appears in Windows' Open with list and a file opened that way lands as a pinned tab in the running window rather than a second one. Every one of them is a pinned tab.

**The file view grows up.** Long lines wrap at the width by default (Wrap in the header, Alt+Z, or the file menu; one setting per window). A `.json` opens in a Pretty view, formatted by Monaco's JSON worker with the keys in their order and the comments kept, on the file's own indent, with Raw beside it and a Format button on Raw that is one undo step; a file that does not parse says `Not valid JSON` and where. And a file can take a colour scheme of its own from the end of the file menu, kept per file, so a document stands out from the terminals around it while its header stays the window's.

**The files rail follows a file, and climbs.** A file tab in front, or a file pane focused, puts the tree on the file's repository (the nearest git root above it, the file's own folder outside any), so a commit's file or a search hit from another repository moves the tree and a file under the current root leaves it alone; an up-arrow before the folder's name lifts the tree one folder up, the old root left open in it, and the lift drops when the followed folder changes. A branch pill after the folder's name shows the checked-out branch.

### Details

**Split with a shell or a Claude.** A right-click on either split button of a pane title offers Split with shell, Split with Claude and a checked Claude by default; the plain click, the empty pane's buttons and the pane menu's Split items all give the default, and their titles say which.

**Three rail smalls.** A search hit drags onto a pane the way a tree row does; one new file no longer paints the tracked files beside it green (a folder git listed tints what is under it, a rolled-up folder tints itself alone); the History tab's search × sits inside its box, clear of the collapse button; and a file open in a pane with no tab hears a change on disk now, its folder watched for as long as the pane is up.

**Sidebar smalls.** The team chevron on a row reads as a button, with a hover ground and a title, and a click on the roster count unfolds and folds the team the same way; a folder heading's menu has Copy path and Reveal in Explorer before the sweeps; and a new layout tab lands at the far right of the strip, after the file tabs, once the strip has an order of its own.

**The usage strip measures its fit.** The four forms (the row, the row with the runways under, the column, the column with the runways stacked) are chosen by measuring the texts rather than by fixed widths, so the box's font smoothing no longer moves the break, and a window whose pace runs out before its reset wears a mark on its bar where the pace hits 100, on the strip, the card and the activity view's axis bar. The strip's reads say what asked in the main log (`asked on mount`), and a tab open asks nothing; the four reads seen around one were four page reloads.

**The demo reset is exact.** `npm run demo` drops the files the template no longer has, so a renamed skill's old command stops answering; a worktree folder a shell still holds is waited on for ten seconds before the reset says so; and the demo skills' checkpoint line reaches the daemon the demo runs under, `zorca set` with no session naming the one it runs in.

**Under the hood.** Every harness log says at its top what the box's animation and font smoothing settings were, and the batch's runner refuses a changed box; `verify:install`'s updater half runs on a private home and pipe with an updater cache of its own, so two runs at once no longer corrupt the shared cache; and a window that starts right after a killed one retries the single-instance lock for twenty seconds rather than opening beside a ghost.

## Fixes 319 to 328, 2026-09-19

Ten fixes from one evening batch, run from a pane end to end and the sixth build to arrive through the updater; the fourth batch with its light fixes on Sonnet agents beside the Opus forks. The daemon's feature level is 52, up from 51, so a window on the previous daemon shows the banner and offers Restart zorcad; take it, or the conflict forecast stays off until you do (the daemon restarts with the install anyway, since the installer stops it).

### Highlights

**The conflict forecast.** While two live sessions sit on branches of one repository that would not merge clean, zorca says so an hour before the merge: each session's sidebar row carries a small run of chevrons and a count in red after its load figure, one per other lane it is tangled with; the lane card reads `conflicts with <name> on <files>` under the branch, with the files cut to `and N more`, and a base line under that, `12 ahead, 40 behind main, forked 2d ago`; on the Commits graph a dashed run of chevrons ties the two lanes' newest nodes with a dotted ring on each end, and a lane forty or more commits behind the default branch wears the figure beside its fork mark. The daemon reads it every minute and on every credited commit through `git merge-tree`, so nothing is checked out and no index is touched. `zorca conflicts` prints the same per repository, every file named, and `zorca conflicts --json` gives the report. To see it, type `/collide` in the demo folder: two worktrees, two shells, two subagents rewriting the same paragraph, held open for a minute.

**A five-hour unit on the activity view.** The unit row gains `5h` between day and hour: the window is the account's current five-hour usage window, so the view shows what ran in the window being paid for, with the usage strip's pace bar drawn full width under the time axis. The current window only (the arrows are off on it, with the reason in their title), and the button is off with its reason when the strip has no reading.

**The install's word, posted from outside.** After the badge's second click the `Installing zorca 0.1.319` toast is raised by a PowerShell process the installer's sweep cannot reach, so it shows during the gap where the last two builds' toasts were killed with the app. This build's install is the first it can show on.

### Details

**The reset word in the window's tone.** On the usage strip a window whose bar reads red (past 90 percent, or the pace running out before the reset) says so in its text too, `resets 5d 18h · 100% in 4d 5h` in red; in a narrow sidebar the runway takes a line of its own under the reset.

**The dollars tick while a team is out.** A shaded pane whose session has a subagent running reads the forks' spend every three seconds rather than every thirty, so the row's `$99 ~` moves as the forks' requests land. Claude Code's own cost figure turned out to move with every status line, so the face's cost cell is as it was.

**A card on the subagent's row.** Hovering a subagent's row in the commit list opens the same card its marker on the graph does, and the card names the member's model beside its state and a line of its own tokens, `↑ 12.3k sent, ↓ 4.1k received, ~$0.42`.

**The downloading badge moves.** While the installer downloads, the title bar's `downloading 37%` badge carries the agent line's sheen, so a slow download reads as a download and not a stall; and the load spark's line form carries its words for a screen reader, `cpu 275% of one core, peak 275% over 5 min`, as the dash form already did.

**The demo's burn answers to `/burn`.** The skill's folder is `burn` now, so the command the docs name is the one Claude Code runs. `docs/design` has an index of every board and handoff and the boards open again on their own runtime.

**Under the hood.** The verify harness takes a free devtools port rather than failing on one a just-closed window still holds; the daemon tests' folder teardown retries on a held handle.

## Fixes 303 to 318, 2026-09-19

Sixteen fixes from one midday batch, run from a pane end to end and the fifth build to arrive through the updater; the third batch with its light fixes on Sonnet agents beside the Opus forks. The daemon's feature level stays 51, so no banner and no restart is asked; the daemon still restarts with the install, since the installer stops it.

### Highlights

**Pace bars on the usage strip.** Each window whose length is known draws a small bar in place of the dial and the percent: the window's span, filled with the share used, ticked at the hours or the days, and crossed by a mark at where the fill would end if the spending were even, so fill past the mark is ahead of pace and short of it behind; the fill goes red when the pace runs out before the reset or the share passes 90. The card's rows carry the same bar full width with the percent beside the name and the runway at the right of the reset line, `now` over the hovered row's mark, and the card sits under the row you hovered rather than at the window's corner.

**The graph tells cherry-picks apart, and dates them right.** A change that is on the graph more than once wears `×3` on the original and `picked` on each copy, the cards list the twins with the branch each sits on, and hovering a copy lights the others. Each row's age is the committer's now, so the column runs one way; the card says `authored 6:27 PM, picked 6:45 PM` when the two clocks differ.

**A batch's lanes told apart.** Under a run session with a dozen forks every member's lane is a tint of the block's colour and the session's own line is drawn heavier with an empty pitch after it, so the rail you look for stands apart from the members.

**New file, new folder, revert, from the Files rail.** A folder's menu heads with `New file` and `New folder`, and the `+` on the header makes one at the root, the name typed in place; a changed file's menu has `Revert changes` under `Show diff`, asking once (`Revert, are you sure?`) and then putting the committed version back, disabled with the reason on a file that has no committed version.

### Details

**Typing into an exited pane says so.** A key or a paste into a pane whose session has exited sends nothing and shows a notice over the kept screen, `exited`, `This session's process has ended; its last screen is kept.`, with a Resume button; it fades four seconds after the last key, and nothing shows from the exit itself.

**The load mark says what it measures.** A muted `cpu` word leads the row's spark, the card reads `cpu 300% of one core`, `memory 1.2 GB`, `peak 300% cpu · 5 min`, and a killed row shows no load at all rather than its last figure.

**The lane card's Show says what it does.** `Focus its pane` when a pane shows the session, `Show in a pane` when none does.

**The shade's running line goes.** The third line under the shade's dollar figure, `+ ~$4.06 running`, read as a second figure to add up; the row's `$99 ~` and its card already say it.

**Crediting under load.** A `git log`, `git rev-list` or another git read run by a member no longer takes the tech lead's fast-forward of `main` as its own when the head moves under it, and a member's head is read off the files before the hook is acked, so a one-commit cherry-pick under eleven forks is credited to the member that made it rather than missed by a spawned read landing late.

**The install-gap toast.** The exe launched by an icon click while an update is installing holds its quit until Windows has shown its `Still installing zorca` toast (six seconds at most), so the toast is no longer taken down with the process before it appears; the first time it can show is the update after this one.

**The demo's burn crosses the amber line.** `/burn` runs three workers rather than two, so its row turns amber past 200 percent of a core on a twelve-core box, and the skill drops its checkpoint comments so the spark stays on the row through the burn.

## Fixes 288 to 302, 2026-09-18

Fifteen fixes from one evening batch, run from a pane end to end and the fourth build to arrive through the updater; the second batch with its light fixes on Sonnet agents beside the Opus forks. The daemon's feature level is 51, up from 50, so a window on the previous daemon shows the banner and offers Restart zorcad; take it, or the load sparkline on the Sessions rows stays off until you do.

### Highlights

**A load sparkline on every working row.** The daemon samples each session's process tree every four seconds (one hidden PowerShell for its whole life, never a spawn per tick) and the Sessions row's agent line ends with five minutes of CPU as a 44 px line and the figure, `38%` in the row's ink, `319%` in amber past two cores; a row with fewer than three samples shows a dash and no figure. The ceiling is shared across the listed rows, so a session at 300 percent beside four idle ones clips at the top with a dashed rule and the four still show their shape. Hover the line for the memory (`640 MB`, `1.2 GB`), the peak over five minutes and the tree's process names. The demo repository gains `/burn [seconds]`, which pegs two cores from the session's own tree so the line climbs and falls back.

**The model on every member.** The Sessions row's team fold reads what the roster card reads, `agent fork · Opus · out 4m · Fix 275 fix-card-agents` with the model's word once the agent has made a request, and its chevron is a real disclosure now, a 16 px box in the row's colour that turns as it opens. The shade lists the subagents under the roster count, one line each with the mark, the model and `working` or `returned` (`running` and `finished` for a shell), twelve at most and `and N more`. On the graph a member's star says its family by size, 12 px for Fable, 10 for Opus, 8 for Sonnet and Haiku, 10 with no request yet, while the session's own star stays 14; and the family word matches its rates again, since `claude-fable-5-1` spells its decimal with a hyphen and the table with a dot, which had priced every Fable and Haiku request at nothing.

**Runway on the usage strip.** Each window's card row says where the average pace lands, `at this pace, about 20% at the reset` or `at this pace, 100% in 1h 30m, before the reset`, and a segment whose pace runs out before its reset goes to the meter's high colour on the strip before the dial does. The strip also shows the Fable window the endpoint sends as a scoped limit, `Fable 7%` with its own reset bar, when the per-model key is null.

**Resume all.** After a daemon stop the Exited heading offers `Resume all` beside `Clear exited`, and its menu `Resume all N` above `Remove all N`: every exited session comes back at once, each in the pane it kept, the ones no pane held as listed rows.

### Details

**The pane title bar's dollar figure carries the running part.** `$9.82 ~` on the bar as on the row, with the card's line as its tooltip, and the bare figure once the main thread's next request lands.

**The badge reads `downloading 0.1.288` until a progress event lands.** A differential download of a few megabytes fires none before it is done, so the badge no longer sits at `downloading 0%` through it, and `zorca update --download` prints `downloading` without a figure the same way.

**With days picked, the week's line prices the pick.** The tally, the tokens and the price after the head are the picked days' own, `22.5h` for two days against the week's `30.0h`; the debt and capped parts stay the window's, since they are the account's.

**Fold code in a file tab.** The gutter's chevron on hover folds a block, Ctrl+Shift+[ and ] fold and unfold at the cursor, and a fold survives a switch to another tab and back, which it never did: the editor's view state was saved after its model had been cleared, so the cursor and the scroll were lost on the way back too.

**The pane menu floats above the files rail.** A menu opened near the rail is no longer painted over by it (it renders from the document's body now), every menu closes on any key rather than Escape alone, so one left open does not float over a file tab brought forward by Ctrl+PageDown, and every menu reads at the chrome's 12 px.

## Fixes 274 to 287, 2026-09-18

Fourteen fixes from one afternoon batch, run from a pane end to end and the third build to arrive through the updater; the first batch whose light fixes ran on Sonnet agents beside the Opus forks, which is why some of these were cheap. The daemon's feature level is 50, up from 49, so a window on the previous daemon shows the banner and offers Restart zorcad; take it, or the capped bands on the activity view and the graph's `remotes` chip in a pane stay off until you do.

### Highlights

**The prices are right now.** Every request Claude Code makes on this box is a 1-hour cache write, which costs twice the input rate, and the rate table priced it at the 5-minute rate, so every `~$` estimate ran a tenth low and the context card blamed an older rate table; the table prices the 1-hour write at its own rate and the card says which rate it is on. The commit cards no longer count a forked agent's traffic twice (a conversation of $187 whose cards summed to $334): an agent with a commit of its own is priced on its line alone and the parent's card says so, `11 agents ran here, priced on their own commits: $155`. Commits credited at one instant, the fork's three that a merge brings in together, are one slice priced once and shown on each, `credited with 2 others at 18:47, priced together`, where every card but the first read `not known`. And the shade's and the row's dollars keep moving while the forks run: `$9.78 + ~$25 running` on the card, `$35 ~` on the row, the agents' spend since the main thread's last request read off their files, back to the bare figure at the next own request.

**Every branch and every person on the graph.** A `remotes` chip beside the draw chips puts the branches that exist only on the remote on the graph as grey blocks named after them, and commits by anyone who is not you draw on a block per person, their name on its pill and a head-and-shoulders glyph on each node, so the graph shows where the humans on the repository are working too; the cards say `fetched 2h ago` or `never fetched`, since zorca never fetches. The graph's agent rows lead with the model's family as one word, `Opus working`, `Sonnet idle · subagent · Read the log`, so a batch of forks on two models reads at a glance.

**Pick the days to compare on the week.** Click a day's label on the week's ridges and the picked days restack adjacent on a peak of their own, the head reads `2 of 7 days`, the off days wait in the gutter as a dimmed list, a double-click solos a day and a click on the head brings the seven back. The density button works on the week too, a condensed form with the names alone, half the scale and the crosshair's figures beside the dots. The week's stats line leads as the day's does, `38.2 agent-hours in 21.4 · 1.8× parallel`, each day's tooltip carrying its own figures, and the end marks at the day before's peak are in the text colour at 2 px so they can be found.

**Cut-off bands.** When a usage window hits 100 percent the activity view draws a faint band across the strip's whole height for as long as the account was cut off (`5-hour window spent, reset 15:00` on hover), the stats line gains ` · 2h capped`, and the waiting is docked by the band as by an away stretch, so the series says when the work was blocked by the plan rather than by anyone.

### Details

**A drag on one gutter moves that gutter alone.** With three stacked panes a drag on the lower seam used to move the upper one in proportion; every other divider keeps its pixels now and the pane against the gutter takes the whole change, columns and rows alike.

**The install's minute says what it is doing.** The badge's second click posts `Installing zorca 0.1.274`, `The window closes now and comes back on its own in about a minute`, and a zorca started by hand in that minute says `Still installing, about 40 s to go` and quits rather than coming up as the old build with the old daemon.

**The unfolded Sessions row shows its price.** The facts line wraps when the row is unfolded, so `~$0.54 (agents ~$0.03)` ends its last line rather than being cut at `mai…` at the rail's default width.

## Fixes 258 to 273, 2026-09-17

Sixteen fixes from one morning batch, run from a pane end to end and the second build to arrive through the updater. The daemon's feature level is 49, up from 48, so a window on the previous daemon shows the banner and offers Restart zorcad; take it, or the activity view's new `this tab` scope and `zorca update` from the command line wait until you do.

### Highlights

**The waiting figure is big now.** Leave a Claude session at a question and a `12s` at 48 px stands in the pane's top right corner over the output, with `waiting` under it and a hush beside it; nothing is washed over, the figure wears a halo in the terminal's own background so the lines under it still read. The sidebar row carries the same count at the row's whole height over its right half, the hush at the same scale, and both roll like an odometer's drum as the seconds tick. A click on the pane or the row takes them away, as before.

**What's New reads as a release note.** Each batch is now an opening line, Highlights (what to try first and how) and Details (a paragraph per change), and every heading in this tab, or in any markdown file you open, folds on a click: the older batches open folded, the newest open, and a fold you make is kept while the app runs.

**The week's ridges say more.** On the week unit each row carries a short dashed mark at either end at the height of the day before's peak (`prev 6` on the day's tooltip, a legend under the scale), the crosshair's dot on each day carries its figure beside it rather than leaving you to count along the readout, and the stats line ends with the week's tokens and price. The now line is blue on every unit, so it no longer reads as one more spike of the amber graph.

**`zorca update` makes the badge's two clicks from a pane.** `zorca update` prints the updater's state (`0.1.240 installed, 0.1.258 available`), `--check` asks for a check, `--download` fetches the build to `ready`, and `--install` does the restart, so a batch that runs unattended can install itself; the daemon relays the clicks to the window and keeps the state for the CLI to read. The updater's differential download works now too: the feed serves the many-range request `electron-updater` sends, so an update fetches the blocks that changed (about 2 percent) rather than the whole installer.

**Right-click a file for Copy.** A file tab or pane, in the editor or the rendered view, has a menu of its own: Copy, Select all, Paste (while the file takes edits), then Copy path, Reveal in Explorer and Open with Windows.

### Details

**A row reads `on Panes` under a file, commits or What's New tab too.** With one layout tab and a file tab in front, every row on that layout tab reads `on Panes` rather than `focused` or `on screen`, and its ground goes off, since no pane is visible; the panes tab brings the words back.

**The activity pane has a fourth scope, `this tab`.** The pill on an activity pane cycles `all`, `folder`, `panes` and `this tab`, the last being the sessions on the panes of the tab that holds the pane alone; the head reads `on <tab name>` and an empty strip `nothing on <tab name>`. The Activity tab in the strip keeps three, since `panes` is the whole-window reading there.

**The crosshair's card keeps off the tick row.** On a short strip the floating card flips above the pointer in the last rows, and on a strip of one lane, shorter than the card, no card is drawn: the lane's words join the axis readout when there is room, and the readout stands alone when there is not.

**The Sessions tab's estimate counts the subagents.** A past conversation's `~$390` prices the agent files beside its transcript too, the tooltip reads `subagents included`, and the unfolded row shows the split, `~$390 (agents ~$287)`; an agent file too large to read is skipped and said so.

**The row's pulse and the pane's wash beat as one.** Every attention pulse restarts on time zero the moment any of them starts, whatever brought it back, and the marker's breathing shares the 1.8 s period.

**A plain Claude under two hook sets posts each event once.** A hook post identical to one accepted within the last second from another hook file is folded, so a project settings file beside the user's, or a script's own hook beside the installed one, no longer doubles `hooks.jsonl`.

**Housekeeping.** A harness daemon stops over its pipe and its ptys' Claudes go with it, so a verify run leaves no `claude --resume` at a trust dialog; the updater test leaves your updater cache as it found it; a daemon whose exit hangs in node-pty reaps itself, and the app's daemon restart kills the old one whenever it is still alive at the grace.

## Fixes 240 to 257, 2026-09-17

Eighteen fixes from one overnight batch, run unattended, and the first build to arrive through the updater: your app saw `0.1.240 available` at the right of its title row, and two clicks did the rest. The daemon's feature level is 48, up from 45, so a window on the previous daemon shows the banner and offers Restart zorcad; take it, or a session's own colour scheme, the away time off the debt and the `panes` scope stay off until you do.

### Highlights

**Every commit now says what it cost.** Hover a commit on the Commits tab and its card reads the stretch of work up to it, `since 3eaf6db, 14:02 to 14:40`, with the cost, the tokens and the agent time, the agents' share as a note, and on a merge the branch's own run priced beside it rather than added in. In a wide pane each row carries its dollars after the subject. A commit no session claims has no price block, and a stretch whose transcript is gone reads `not known` rather than a zero.

**A file tab is an editor.** Open a text file from the rail and type: the tab and the header wear `●` until Ctrl+S saves it, with the file's line endings and BOM kept. A close under unsaved edits asks first, and when something else writes the file under your edits a `changed on disk` line offers Reload and Keep mine instead of overwriting them. Transcripts stay read-only.

**A counter climbs over the pane that needs you.** Leave a Claude session at a question and `waiting 12s` (or `done 40s`) counts up in the pane's top right corner while it pulses; the sidebar row's age takes the same tone and size, and both go at the click.

**A colour scheme for one session.** Right-click a terminal, turn on `This session only` at the head of the Colour scheme section and pick a scheme: that session's terminal alone takes it, background included, and the scheme follows the session to any pane it is shown in. `Window's scheme` puts it back, and `zorca set --scheme` does the same from the CLI.

**The activity view reads what is on screen.** Open the Activity tab and cycle the scope pill to `panes`, the sessions on the panes of every tab, so the strip can be read for what is in front of you. On a tall strip the crosshair's readout now floats beside the pointer at its height, a third line naming the lane under it and what it was doing, flipped to the left near the right edge.

### Details

**The Sessions tab's rows end with what the conversation cost.** `6 prompts · 3m ago · Opus 5 · ~$1.40`, an estimate from our rate table for a past conversation, or Claude Code's own bare figure for a live one.

**The Commits tab in a folder that is no repository.** Instead of one line and a blank panel, the sessions in the folder are drawn as lanes with one node per file they wrote, a ledger above them with each session's cost, tokens, state and writes, and `Initialise a repository` beside the note; press it and the panel becomes the commit graph as anywhere.

**A leader from every commit node to its row.** Every node on the upright graph has a faint dotted leader to its row, the hovered row's drawn at full strength, so a node on a far lane is easy to tie to its line.

**Away time is not attention debt.** A question or a finished turn left overnight while the app was closed, the screen locked, the box asleep or nobody at the keyboard for ten minutes is docked from the day's waiting figure, which now counts from your return; the stats line's tooltip reads `8h 12m away not counted`.

**The cost in the pane title.** The pane title's reading carries the session's dollars after the percent, as the sidebar row does, and gives it up before the dial when the pane narrows.

**The rows no pane shows.** A sidebar row reads `on <tab name>` when its session is on another tab and `on no pane`, dimmed, when it is on none; the folder heading counts them, an `unshown` chip filters to them, and Close all under a filter takes the filtered rows alone.

**A tick at the previous day's peak.** On the week's ridges each day carries a faint dashed line at the day before's peak, so a ridge crossing it means what it looks like.

**`Check for updates` says where the update stands.** The Z menu's item reads `no feed at 127.0.0.1:7420` on a box with no feed, `checked 18:43, up to date` after a check that found nothing newer, and `failed, try again` only when the feed answered badly.

**The daemon serves the update feed.** Nothing has to run `zorca feed serve` any more: the daemon serves `%LOCALAPPDATA%\zorca-feed` on port 7420 when the folder exists, `zorca daemon status` says so, and the daemon's version now agrees with the app's (`0.1.240`) instead of reading `0.1.0`.

**A missing Claude home is an empty scan.** An app pointed at a Claude home folder that is not there scans nothing and watches nothing, says so once in the log, and names what is still alive when its last window closes so a stuck exe can be read off the log.

## Fixes 228 to 239, 2026-09-16

Twelve fixes from one afternoon's batch. The daemon's feature level is 45, up from 43, so a window on the previous daemon shows the banner and offers Restart zorcad; take it, or attention debt and the outside sessions stay off the activity view until you do. This is the first build with a version number that says which batch it is (`0.1.228`) and the first with an updater, though this one still installs by hand; the next batch's build is the first to arrive through the feed.

### Highlights

**A week on the activity view.** Open the Activity tab and cycle the unit pill to the week: one ridge per day aligned on the hour of day, oldest at the top and today in front, all on one scale, each labelled with its peak and its agent-hours. The stats line reads the week's peak with its day and time, the busiest hour across the week and the week's agent-hours; the crosshair reads one hour down every day and gives the median. `zorca activity --week` prints the same seven profiles.

**Attention debt: the time the agents spent waiting on you.** Leave a Claude session at a question for a minute and look at the stats line: a question left at needs input, or a finished turn left unread for more than a minute, is time the agent could have been working, and the line reads the window's total, `1h 12m waiting on you`, in the teal that already means waiting. Under the load band a mirrored teal strip shows when it piled up, the lanes carry an asked stretch as a teal line and an unread one as a hairline, the name gutter has each session's figure, and while any session is asking the header carries a pulsing teal square and the longest current wait. `/demo-solo ask` shows it accrue.

**A stalled session says `quiet`.** A working session that has posted nothing for longer than its own turn's pace (three times its median gap between tool calls, ten minutes at least) pulses in the muted tone with `quiet 12m` on its badge, chimes and notifies like the other states, and can be hushed. `zorca wait --for stale` and the word in `zorca ls` let a supervising session catch it first; `/demo-solo quiet` hangs one tool call past the floor.

**A menu on the Z.** Click the mark at the top left: What's new (with the build's version as its hint), Key cheat sheet, Run an action, and Check for updates. The cheat sheet says where the palette is, and the empty pane's last line points at the Z.

**An updater, for the batch after this one.** The app checks a local feed (`zorca feed serve`, port 7420) at launch and every four hours and, when a newer build is there, shows `0.1.<N> available` at the right of the title row; a click downloads, a second click closes the window, stops the daemon with its screens kept, runs the installer silently and relaunches, and every pane comes back through Resume. Nothing installs on its own, and `ZORCA_NO_UPDATE=1` turns the check off. This build installs by hand as before, since the one it replaces has no updater.

### Details

**The load band and the token bars keep up with the agents.** The amber band runs to the now line while a session works instead of stopping wherever the last fetch landed, and the token bars are one second each, twenty-four seconds across, the newest bar growing as each status line lands and a long reply's tokens spread over the seconds it took, with a sharp rise and an eased fall.

**A Claude you started in a plain terminal counts.** Once `zorca hooks install` has run, a `claude` outside zorca posts its hooks to the running daemon too, so its hours are on the activity view under the folder it ran in, named from its transcript, with `outside zorca` in its tooltip. It is not a session: `zorca ls` does not list it, and one you later resume in a pane joins that pane's row.

**The shade's figures roll like an odometer.** Pull a pane's shade and watch: when a count on the face goes up, the digits that changed roll up together; the letters and the `$` stay still.

**The first lane's slab is whole.** On the Commits graph the first lane's ground slab is no longer cut at the graph's left edge, so a single lane's line stands in the middle of it.

**A narrow pane keeps its zoom and its shade to the last.** As a pane title narrows it now gives up the state word, then the name, then hide and close, so at about 75 px a pane still shows its mark, its zoom and its shade.

**Typing lag under real turns, measured.** The latency bench ran four real Claude turns on this box, hidden and shown: the keystroke round trip was p90 54 to 62 ms with them as without, with no long task in the renderer and both event loops under 41 ms, since a turn spends most of its life waiting on the API. The handbook's `bench:latency` line says how to run the same round on another box.

## Fixes 211 to 227, 2026-09-16

Seventeen fixes from one overnight batch, and the first build to open this tab. The daemon's feature level is 43, up from 41, so a window on the previous daemon shows the banner and offers Restart zorcad; take it, or the activity view's new figures and the graph's zoom stay off until you do.

### Highlights

**The focused session's tree stands on a slab.** Focus a pane whose session has commits on the Commits graph: its tree stands on a ground slab fitted to its own rows, its lanes wide, fading out over 22px at either open end, so another session's tree that reuses the same columns further down never stands on lit ground. Focus is carried by weight: the focused tree's lanes are heavier and its dots larger, every other tree thinner and at half opacity while one is focused, and everything back to the one weight when none is. The List view gets the same slab.

**Ctrl+wheel zooms the graph and the activity strip.** Over a commits graph, Ctrl+wheel steps the whole picture from half size to double in seven steps, the point under the pointer staying put the way a map does, and the plain wheel keeps scrolling; the zoom is kept with the orientation, so every pane and tab of the folder zoom together. Over the activity strip and the activity view the same chord stretches the time axis under a sideways scroll.

**The activity view's top line carries the window's numbers.** Open the Activity tab and read its top line: beside the agent time, the parallelism and the peak it now has the window's commits and merges (`14 commits, 3 merges`), its tokens up and down and its cost (`↑3.2M ↓84k · $12.40`, a `~` marking a figure priced from the rate table where Claude Code gave none), and a sparkline of 24 bars just before `7 running now`, two minutes of output tokens in five-second buckets. All of it moves as the work runs, on the tab, the pane and the rail's card alike, and `zorca activity` prints the same.

**Colour schemes for the terminal.** Right-click a pane and the menu ends in `Colour scheme`: zorca's own, Dracula, Solarized Dark, One Dark and Tokyo Night, then any scheme in your Windows Terminal `settings.json` under its own name. The pick is per window and remembered, applies to every terminal at once, and the pane's ground takes the scheme's background so a light scheme does not sit in a dark frame. The chrome around the terminals does not change.

**This tab.** A new build opens What's New once, pinned and active, on the section for the batch it carries; close it and it stays closed until the next build. Ctrl+Shift+P then `what` brings it back any time.

### Details

**A sideways graph with the rows off is only as long as its picture.** With the rows hidden, the scroll extent is the drawn commits and not the whole log, so the thumb covers what there is to see and a short graph sits centred with no empty run before it. Hiding a block or toggling the active filter moves the picture's start, and the scroll anchor holds the commit you were looking at in place.

**The commit rows say which branch they are on.** Each row of the Graph and List views leans its subject in by a step per branch off the trunk, behind a hairline in its session's colour running the row's height, so a run of one branch's commits reads as one bracket and a main commit between them sits flush left. A branch off a branch leans two steps, capped at three so a deep chain never eats the subject.

**The folder scope keeps sessions whose rows were closed.** On the Activity tab under `folder`, a session you removed from the sidebar still has its row and its hours, since the daemon now sends each track's folder, so a day's axis under a folder runs from the morning's first span and not from the sessions still open.

**Typing stays quick while several turns run.** Every git the app and the daemon run for the sidebar, the rail and the commit credits now runs on a worker thread, so a keystroke's trip no longer waits behind a `git status` spawned on the same loop; on the bench that took the wait at four loaded turns from a p90 of 88 ms to the idle round's 40 to 50, and the git stalls of a hundred milliseconds and more from the main process's log are gone. `npm run bench:latency` is the bench, in the acceptance scripts list.

**Small things.** The rail's two open buttons wear icons that say tab and pane instead of two glyphs you had to hover. A layout tab with no session in any pane draws no idle mark. The sidebar row shows the session's cost where its token split was, one short figure, with the tokens back as the sidebar widens; the split stays on the context card. A narrow pane title hides the context percent whole instead of slicing it. The empty pane's filter placeholder gives from the tail as the box narrows, so `> for actions` is not the first thing cut. The rail's commits section no longer reads `Not a git repository` while an Activity tab is active and the read is still in flight.

## Fixes 195 to 210, 2026-09-15

Sixteen fixes from two evening batches, installed together. The daemon's feature level is 41, up from 39, so a window on the previous daemon shows the banner and offers Restart zorcad; take it, or the shell marks and the touched-file dots below stay off until you do.

### Highlights

**Shells say what they are doing.** Run a command in a shell pane and watch its mark: it reads the command's state off the prompt itself, not off how much it prints, running while a command runs, even a silent one, and red with `failed (3)` in the tooltip when the last command exited non-zero, cleared by the next command that succeeds. `zorca ls` and `zorca explain` carry the same. A command that ran longer than a minute marks the row as wanting when it ends, the way a Claude turn's done does, so a long build finishing while you are elsewhere gets the pulse and the chime; short commands never do.

**The files rail marks what changed and who changed it.** Open a folder with uncommitted changes in the rail: a folded folder carries the summed `+55 −22` of every changed file under it, with the file count in its tooltip, and a file a session edited wears a dot in that session's colour after its counts, two dots when two sessions touched it, the tooltip naming each and when. The changed row's letter is a click target, `Show the diff`, and `Show diff` heads the row's menu: both open the Review tab on that file, and with no session focused the tab reviews the folder itself. The sidebar's folder heading gets a small dot while the tree has uncommitted changes, gone the moment the tree is clean.

**Two new keys, and a palette of actions.** Press Ctrl+Shift+P (or the prefix then `:`, or `>` typed first into the picker) for a palette of every action by its label with its chords at the right, Enter running it; the focused pane's menu items with no chord join under a `Pane` heading. Ctrl+Shift+A (or the prefix then `a`) jumps to the session that has waited longest for you, needs-input first, then done, then errored; a second press within four seconds takes the next, and comes round. The picker lists the waiting sessions first with how long each has waited.

**File tabs behave like an editor's.** A single click in the rail opens a file into one preview tab, drawn in italics, that the next single click reuses, so ten clicks are one tab and not ten; a double click pins it, and a drag, a menu's Open in a tab or any other opener pins too. Ctrl+click on a URL printed in a pane opens it in the browser; a plain click stays the terminal's.

### Details

**Commits made by scripts count.** A commit a session made through anything but a literal `git commit`, a `node tools/land.mjs` say, is credited to that session on the Commits graph, in its colour, rather than falling into the grey block of commits nobody made. The daemon reads HEAD off the repository's files before and after every tool call, so no extra git process is started for it.

**The shade's face is designed.** Under the mark and the name, the tokens read as two figures side by side, `↑113.4k` over `sent` and `↓2.7k` over `received`, with `94.8k cached` under the sent cell, then the cost as the largest figure in a cool green over `at API rates, subagents included`. The cost is Claude Code's own figure for everything the process paid for, forked agents included; the context card off a row's tokens keeps the estimate from the rate table beside the parts it is computed from, `this pane's requests: ~$0.23 cached, ~$0.63 uncached`, and says when Claude Code's total sits well above or below it.

**A pane wanting attention breathes over its whole ground.** Beside the ring and the title's pulse, the pane's ground washes to the state's colour at a fifth and back on the same clock, so the pane that needs you is the first thing the eye lands on among six; off under reduced motion.

**The activity view tells you what is running now.** The stats line ends in `7 running now`, the count at this instant beside the window's figures, on the tab, the pane and the rail's card alike, and the load band's now line carries `7×` at its head, falling as sessions stop.

**Narrow panes keep the zoom button.** A pane title that runs out of room now folds the roster, drops the tokens, hides the two split buttons, then the shade toggle, and never the zoom, hide and close, so a narrow pane can always be given the whole tab.

**The sideways graph stays where you put it.** A commits pane on its side with the rows off keeps the commit you scrolled to under your eye while the work grows: a commit landing, a subagent's track added or taken, the pane resized, none of them move the picture, where before every commit that landed slid it one column.
