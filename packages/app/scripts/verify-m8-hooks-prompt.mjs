// M8 acceptance: the hooks banner. Runs the built app under a private
// EMERALD_HOME, EMERALD_PIPE and CLAUDE_SETTINGS (so the real settings file is
// never touched), seeded with a foreign hook and a permission that must
// survive. Six launches: the banner offers to install and Install writes
// all 16 entries plus the script and the emmer-cli skill; a relaunch shows
// no banner; with the skill edited the banner names it and Install puts
// the shipped one back; with the script deleted the banner names that and
// Not now hides it; with promptHooks false in config.json nothing shows.
// M9 fix 606: the banner's Test reads the missing script before the first
// install; with the window left open after the second launch, an entry
// stripped from the settings raises the banner, the Test passes through
// the installed hook to the daemon, the bytes put back lower it, and a
// record of three installs with the file rewritten since shows the other
// writer's phase with Install disabled.
// M9 fix 710: entries of an old home pointing at missing files raise the banner with Fix, which takes them out and leaves a stranger's.
// The private daemon the app autostarts is stopped at the end.
// Logs to %TEMP%\emerald-verify\hooks-prompt.log, or hooks-prompt-<basename of the home>.log when EMERALD_HOME is given; runs on the EMERALD_HOME and EMERALD_PIPE it is given, else its own pair, and refuses a home outside the temp folder (M9 fix 641). Build first (npm run build,
// then npm run build -w @emerald/app). Run: npm run verify:hooks-prompt -w @emerald/app
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const verifyDir = path.join(os.tmpdir(), 'emerald-verify');
const home = process.env['EMERALD_HOME'] ?? path.join(verifyDir, 'hooks-home');
const pipe = process.env['EMERALD_PIPE'] ?? '\\\\.\\pipe\\emmerd-verify-hooks';
const settings = path.join(home, 'claude-settings.json');
const script = path.join(home, 'hooks', 'claude-hook.cmd');
const skill = path.join(home, 'skills', 'emmer-cli', 'SKILL.md');
const logFile = path.join(verifyDir, process.env['EMERALD_HOME'] === undefined ? 'hooks-prompt.log' : `hooks-prompt-${path.basename(home)}.log`);
const t0 = Date.now();

// A given home is wiped whole below (M9 fix 641), so it must sit under the
// temp folder. os.tmpdir() can be the 8.3 short form (C:\Users\RUNNER~1 on a GitHub runner)
// and a runner may pass the long one, so both sides are compared with their
// existing part resolved by realpath.
const real = (p) => { let at = path.resolve(p); const rest = []; while (!fs.existsSync(at)) { rest.unshift(path.basename(at)); const up = path.dirname(at); if (up === at) break; at = up; } let top = at; try { top = fs.realpathSync.native(at); } catch {} return path.join(top, ...rest); };
const inside = path.relative(real(os.tmpdir()), real(home));
if (inside === '' || inside.startsWith('..') || path.isAbsolute(inside)) {
  console.error(`[verify] FAIL refusing EMERALD_HOME ${home}: this script wipes its home whole, and the home must sit under ${os.tmpdir()}`);
  process.exit(1);
}

// cdp.mjs reads EMERALD_HOME when it loads, so the environment is set before
// the import below, and the app and its daemon inherit all three.
process.env['EMERALD_HOME'] = home;
process.env['EMERALD_PIPE'] = pipe;
process.env['CLAUDE_SETTINGS'] = settings;
const { expect: cdpExpect, freshPort, killTree, launch, sleep, stopDaemon } = await import('./cdp.mjs');

fs.rmSync(home, { recursive: true, force: true });
fs.mkdirSync(home, { recursive: true });
fs.mkdirSync(verifyDir, { recursive: true });
fs.writeFileSync(logFile, '');

setTimeout(() => {
  log('WATCHDOG: run exceeded 120 s');
  cleanupHard();
  process.exit(3);
}, 120000);

let current = null;

function log(msg) {
  const line = `[verify +${((Date.now() - t0) / 1000).toFixed(2)}s] ${msg}`;
  console.log(line);
  fs.appendFileSync(logFile, line + '\n');
}

function expect(cond, what) {
  if (!cond) {
    log(`FAIL: ${what}`);
    cleanupHard();
    process.exit(1);
  }
  log(`ok: ${what}`);
}

function cleanupHard() {
  if (current !== null) killTree(current.child);
  stopDaemon();
}

const readSettings = () => JSON.parse(fs.readFileSync(settings, 'utf8'));
// Takes emerald's hook off Stop and leaves the foreign one (M9 fix 606).
const strip = () => {
  const f = readSettings();
  f.hooks.Stop = f.hooks.Stop.filter((g) => !g.hooks.some((h) => String(h.command).toLowerCase().includes('claude-hook.cmd')));
  fs.writeFileSync(settings, JSON.stringify(f, null, 2));
};
const banner = (s) => s.evalJs(`(() => { const b = document.querySelector('.hooks-banner'); return b ? { text: b.textContent, title: b.title, phase: b.dataset.phase } : null; })()`);

// One line at the default width (M9 fix 579): the banner's height is the Install button's plus its 8px of padding and 2px more (28 against 18 measured) while the text holds one line; a wrapped one reads 40, so 4px of slack tells them apart.
const oneLine = (s) => s.evalJs(`(() => { const b = document.querySelector('.hooks-banner').getBoundingClientRect(); const i = document.querySelector('.hooks-install').getBoundingClientRect(); return { banner: b.height, install: i.height, width: window.innerWidth }; })()`);

async function open(port) {
  const s = await launch(port, {});
  current = s;
  // The check runs after the config and the daemon connection; the layout
  // appearing means both landed.
  await s.waitFor(`!!document.querySelector('.pane, .empty-pane')`, 'layout rendered', 15000);
  return s;
}

async function close(s) {
  killTree(s.child);
  current = null;
  await sleep(800);
}

const seed = {
  hooks: { Stop: [{ hooks: [{ type: 'command', command: 'C:/other/tool.cmd' }] }] },
  permissions: { allow: ['Bash(ls)'] },
};
fs.writeFileSync(settings, JSON.stringify(seed, null, 2));

try {
  void cdpExpect;
  log(`log: ${logFile}`);

  // 1. Fresh settings: the banner offers, Install writes everything.
  let s = await open(freshPort());
  await s.waitFor(`!!document.querySelector('.hooks-banner')`, 'hooks banner', 10000);
  let b = await banner(s);
  expect(/not installed/.test(b.text) && b.phase === 'prompt', `banner says the hooks are not installed: ${b.text}`);
  expect(b.title.includes(settings), 'banner tooltip names the private settings file');
  const line1 = await oneLine(s);
  expect(line1.width <= 1200 && line1.banner - (line1.install + 8) <= 4, `the banner is one line at the default width: ${JSON.stringify(line1)}`);
  await s.screenshot('m8-hooks-banner.png');
  // M9 fix 606: the Test before any install finds no script.
  await s.evalJs(`document.querySelector('.hooks-test').click()`);
  await s.waitFor(`(document.querySelector('.hooks-banner')?.textContent ?? '').includes('Test failed: the hook script is missing.')`, 'the Test says the hook script is missing', 10000);
  await s.evalJs(`document.querySelector('.hooks-install').click()`);
  await s.waitFor(`!document.querySelector('.hooks-banner')`, 'banner gone after install', 15000);
  let file = readSettings();
  const events = Object.keys(file.hooks ?? {});
  const ours = events.filter((e) => (file.hooks[e] ?? []).some((g) => (g.hooks ?? []).some((h) => String(h.command).toLowerCase().includes('claude-hook.cmd'))));
  expect(ours.length === 16, `16 events carry the emerald hook, got ${ours.length}`);
  expect(file.hooks.Stop.some((g) => g.hooks.some((h) => h.command === 'C:/other/tool.cmd')), 'the foreign Stop hook survived');
  expect(JSON.stringify(file.permissions) === JSON.stringify(seed.permissions), 'permissions survived');
  expect(fs.existsSync(script), 'hook script installed under the private home');
  expect(fs.existsSync(`${settings}.emerald-bak`), 'a backup of the previous settings was kept');
  // M18: the skill goes in the skills folder beside the settings file.
  expect(fs.existsSync(skill) && /^---\r?\nname: emmer-cli\r?\n/.test(fs.readFileSync(skill, 'utf8')), 'the emmer-cli skill landed beside the private settings file');
  await close(s);

  // 2. Installed: no banner.
  s = await open(s.port + 1);
  await sleep(2500);
  expect((await banner(s)) === null, 'no banner once the hooks are installed');
  // M9 fix 606: the window stays open. An entry taken out raises the
  // banner, the Test passes, and the same bytes put back lower it.
  const installed = fs.readFileSync(settings, 'utf8');
  strip();
  await s.waitFor(`(() => { const b = document.querySelector('.hooks-banner'); return !!b && /Only 15 of 16/.test(b.textContent) && b.dataset.phase === 'prompt'; })()`, 'the banner rises when the settings lose an entry while the app runs', 8000);
  await s.evalJs(`document.querySelector('.hooks-test').click()`);
  await s.waitFor(`(document.querySelector('.hooks-banner')?.textContent ?? '').includes('Test passed: the hook reached emerald.')`, 'the Test passes through the installed hook to the daemon', 10000);
  const line2t = await oneLine(s);
  expect(line2t.width <= 1200 && line2t.banner - (line2t.install + 8) <= 4, `the banner is one line with the Test button and its result: ${JSON.stringify(line2t)}`);
  await s.screenshot('m8-hooks-test-passed.png');
  fs.writeFileSync(settings, installed);
  await s.waitFor(`!document.querySelector('.hooks-banner')`, 'the banner lowers when the hooks come back', 8000);
  // Another writer: three installs of ours in the last minute and the
  // file no longer the bytes we wrote.
  const record = path.join(home, 'hooks', 'settings-written.json');
  const now = Date.now();
  fs.writeFileSync(record, JSON.stringify({ [path.resolve(settings).toLowerCase()]: { sha256: '0'.repeat(64), writes: [now - 3000, now - 2000, now - 1000] } }));
  strip();
  await s.waitFor(`(() => { const b = document.querySelector('.hooks-banner'); return !!b && b.dataset.phase === 'fighting' && b.textContent.includes('Another program, or a second emerald, keeps rewriting these settings.') && document.querySelector('.hooks-install').disabled; })()`, 'the banner names another writer and offers no Install', 8000);
  const line2w = await oneLine(s);
  expect(line2w.width <= 1200 && line2w.banner - (line2w.install + 8) <= 4, `the banner is one line with the other writer's sentence: ${JSON.stringify(line2w)}`);
  await s.screenshot('m8-hooks-other-writer.png');
  // The record goes before step 2b, whose Install would meet a disabled button.
  fs.rmSync(record, { force: true });
  fs.writeFileSync(settings, installed);
  await s.waitFor(`!document.querySelector('.hooks-banner')`, 'the banner lowers once the hooks are back', 8000);
  await close(s);

  // 2b. Skill edited by hand: the banner names it, Install puts the shipped one back.
  fs.appendFileSync(skill, '\nedited\n');
  s = await open(s.port + 1);
  await s.waitFor(`!!document.querySelector('.hooks-banner')`, 'hooks banner with the skill edited', 10000);
  b = await banner(s);
  expect(/emmer-cli skill/.test(b.text), `banner names the skill: ${b.text}`);
  const line2b = await oneLine(s);
  expect(line2b.width <= 1200 && line2b.banner - (line2b.install + 8) <= 4, `the banner is one line with the longest problem, the skill's: ${JSON.stringify(line2b)}`);
  await s.evalJs(`document.querySelector('.hooks-install').click()`);
  await s.waitFor(`!document.querySelector('.hooks-banner')`, 'banner gone after the reinstall', 15000);
  expect(!fs.readFileSync(skill, 'utf8').includes('edited'), 'the reinstall wrote the shipped skill back');
  await close(s);

  // 2c. M9 fix 710: entries of an old home pointing at missing files raise
  // the banner with Fix, which takes them out and leaves a stranger's (the
  // seed's C:/other/tool.cmd, dead too, is named by the CLI and never counted).
  {
    const fwdHome = home.split(path.sep).join('/');
    const f = readSettings();
    const oldHook = `"${fwdHome}/old-home/hooks/claude-hook.cmd"`;
    const oldTool = `"${fwdHome}/old-tool/hook.cmd"`;
    f.hooks.Stop.push({ hooks: [{ type: 'command', command: oldHook }] });
    f.hooks.SessionStart.push({ hooks: [{ type: 'command', command: oldHook }] });
    f.hooks.Stop.push({ hooks: [{ type: 'command', command: oldTool }] });
    fs.writeFileSync(settings, JSON.stringify(f, null, 2));
    s = await open(s.port + 1);
    await s.waitFor(
      `(() => { const b = document.querySelector('.hooks-banner'); const i = document.querySelector('.hooks-install'); return !!b && b.dataset.phase === 'prompt' && b.textContent.includes("2 hooks in Claude's settings point at missing files.") && b.textContent.includes("Fix takes out emerald's old entries and installs the current ones.") && !!i && i.textContent === 'Fix'; })()`,
      'the banner names two dead entries of ours and offers Fix',
      10000,
    );
    const line2c = await oneLine(s);
    expect(line2c.width <= 1200 && line2c.banner - (line2c.install + 8) <= 4, `the banner is one line with the dead entries' sentence: ${JSON.stringify(line2c)}`);
    await s.screenshot('m8-hooks-dead.png');
    await s.evalJs(`document.querySelector('.hooks-install').click()`);
    await s.waitFor(`!document.querySelector('.hooks-banner')`, 'banner gone after Fix', 15000);
    const fixed = readSettings();
    const stop = fixed.hooks.Stop.flatMap((g) => g.hooks ?? []).map((h) => h.command);
    expect(!JSON.stringify(fixed).includes('old-home'), 'Fix took out every entry of the old home');
    expect(stop.includes(oldTool) && stop.includes('C:/other/tool.cmd'), "the stranger's dead entries stay on Stop");
    const ourScript = script.split(path.sep).join('/').toLowerCase();
    const oursNow = Object.keys(fixed.hooks).filter((e) => (fixed.hooks[e] ?? []).some((g) => (g.hooks ?? []).some((h) => String(h.command).toLowerCase().includes(ourScript))));
    expect(oursNow.length === 16, `16 events carry the hook under the private home after Fix, got ${oursNow.length}`);
    await close(s);
  }

  // 3. Script deleted: the banner says so, Not now hides it and writes nothing.
  fs.unlinkSync(script);
  const before = fs.readFileSync(settings, 'utf8');
  s = await open(s.port + 1);
  await s.waitFor(`!!document.querySelector('.hooks-banner')`, 'hooks banner with the script missing', 10000);
  b = await banner(s);
  expect(/script is missing/.test(b.text), `banner names the missing script: ${b.text}`);
  await s.evalJs(`document.querySelector('.hooks-dismiss').click()`);
  await s.waitFor(`!document.querySelector('.hooks-banner')`, 'banner gone after Not now', 5000);
  await sleep(500);
  expect(fs.readFileSync(settings, 'utf8') === before && !fs.existsSync(script), 'Not now changed nothing');
  await close(s);

  // 4. promptHooks false: silent even though the script is still missing.
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ promptHooks: false }));
  s = await open(s.port + 1);
  await sleep(2500);
  expect((await banner(s)) === null, 'promptHooks false silences the banner');
  await close(s);

  stopDaemon();
  log('PASS');
  process.exit(0);
} catch (err) {
  log(`FAIL: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  if (current !== null) log(current.logs.join(''));
  cleanupHard();
  process.exit(1);
}
