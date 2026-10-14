import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { createUpdater, isNoFeedError, updateFeedSpec } from './updater.ts';
import type { FeedSpec, UpdaterLike } from './updater.ts';
import type { UpdateState } from '../renderer/src/update-model.ts';

// electron-updater stood in by an emitter: the events it would fire are
// fired by hand, and the calls it would take are recorded.
class FakeUpdater extends EventEmitter implements UpdaterLike {
  autoDownload = true;
  autoInstallOnAppQuit = true;
  allowDowngrade = true;
  disableWebInstaller = false;
  logger: UpdaterLike['logger'] = null;
  feed: FeedSpec | null = null;
  calls: string[] = [];
  // A download that fails emits error first and then rejects, in
  // electron-updater's order (AppUpdater.js:449 to :470).
  failDownload: Error | null = null;
  setFeedURL(options: FeedSpec) {
    this.feed = options;
  }
  async checkForUpdates() {
    this.calls.push('check');
    return null;
  }
  async downloadUpdate() {
    this.calls.push('download');
    if (this.failDownload !== null) {
      this.emit('error', this.failDownload);
      throw this.failDownload;
    }
    return [];
  }
  quitAndInstall(isSilent: boolean, isForceRunAfter: boolean) {
    this.calls.push(`install ${isSilent} ${isForceRunAfter}`);
  }
}

function setup(feed: FeedSpec | null = { provider: 'generic', url: 'http://127.0.0.1:7420/' }, intervalMs = 4 * 3600 * 1000) {
  const fake = new FakeUpdater();
  const pushed: UpdateState[] = [];
  const log: string[] = [];
  const order: string[] = [];
  const updater = createUpdater({
    current: '0.1.228',
    feed,
    intervalMs,
    firstDelayMs: 0,
    log: (m) => log.push(m),
    push: (s) => pushed.push(s),
    now: () => new Date(2026, 8, 16, 18, 43),
    stopDaemon: async () => {
      order.push('daemon stopped');
    },
    markInstalling: (version) => {
      order.push(`marked ${version}`);
    },
    postPoster: (version) => {
      order.push(`posted ${version}`);
    },
    updater: () => fake,
  });
  return { fake, pushed, log, order, updater };
}

test('off with no feed: no check, no configuration, the state says off', () => {
  const { fake, updater, log } = setup(null);
  updater.start();
  assert.equal(updater.state().phase, 'off');
  assert.equal(fake.feed, null);
  assert.equal(fake.autoDownload, true);
  assert.deepEqual(fake.calls, []);
  assert.ok(log.some((l) => l === 'update check off'));
});

test('with a feed: a newer build downloads on its own with autoDownload still off, the URL set (M9 fix 625)', () => {
  const { fake, updater, pushed } = setup();
  assert.equal(fake.autoDownload, false);
  assert.equal(fake.autoInstallOnAppQuit, false);
  assert.equal(fake.allowDowngrade, false);
  assert.equal(fake.disableWebInstaller, true);
  assert.deepEqual(fake.feed, { provider: 'generic', url: 'http://127.0.0.1:7420/' });
  assert.equal(updater.state().phase, 'idle');
  fake.emit('checking-for-update');
  assert.equal(updater.state().phase, 'checking');
  fake.emit('update-available', { version: '0.1.240' });
  assert.equal(updater.state().phase, 'downloading');
  assert.equal(updater.state().latest, '0.1.240');
  assert.equal(updater.state().percent, null);
  assert.equal(pushed.at(-1)?.phase, 'downloading');
  assert.deepEqual(fake.calls, ['download']);
  assert.equal(fake.autoDownload, false);
});

test('every answer to a check counts once, the same answer twice included, and an answer with no check before it counts nothing (M9 fix 539)', async () => {
  const { fake, updater, pushed } = setup();
  assert.equal(updater.state().checks, 0);
  fake.emit('checking-for-update');
  fake.emit('update-not-available', { version: '0.1.228' });
  assert.equal(updater.state().checks, 1);
  // The count lands in the same push as the answer.
  assert.equal(pushed.at(-1)?.checks, 1);
  const first = updater.state().message;
  // The test's clock is fixed, so this is the same-minute check.
  await updater.act();
  assert.equal(updater.state().checks, 1);
  fake.emit('update-not-available', { version: '0.1.228' });
  assert.equal(updater.state().checks, 2);
  assert.equal(updater.state().message, first);
  // A scheduled answer that never set checking counts nothing.
  fake.emit('update-available', { version: '0.1.100' });
  assert.equal(updater.state().phase, 'idle');
  assert.equal(updater.state().checks, 2);
});

test('a feed at the running version or behind it stays idle', () => {
  const { fake, updater } = setup();
  fake.emit('update-available', { version: '0.1.228' });
  assert.equal(updater.state().phase, 'idle');
  fake.emit('update-available', { version: '0.1.100' });
  assert.equal(updater.state().phase, 'idle');
  fake.emit('update-not-available', { version: '0.1.228' });
  assert.equal(updater.state().phase, 'idle');
  assert.equal(updater.state().latest, '0.1.228');
});

test('a check that reaches no feed is idle with the fact on its message, asked or not (M9 fix 242)', async () => {
  const { fake, updater } = setup();
  fake.emit('checking-for-update');
  fake.emit('error', new Error('net::ERR_CONNECTION_REFUSED'));
  assert.equal(updater.state().phase, 'idle');
  assert.equal(updater.state().message, 'no feed at 127.0.0.1:7420');
  await updater.act();
  assert.deepEqual(fake.calls, ['check']);
  assert.equal(updater.state().phase, 'checking');
  // The last outcome stays on the record under the checking phase.
  assert.equal(updater.state().message, 'no feed at 127.0.0.1:7420');
  fake.emit('error', new Error('connect ECONNREFUSED 127.0.0.1:7420'));
  assert.equal(updater.state().phase, 'idle');
  assert.equal(updater.state().message, 'no feed at 127.0.0.1:7420');
  fake.emit('checking-for-update');
  fake.emit('error', new Error('net::ERR_CONNECTION_TIMED_OUT'));
  assert.equal(updater.state().phase, 'idle');
  assert.equal(updater.state().message, 'no feed at 127.0.0.1:7420');
});

test('a feed that answered badly is silent on its own and an error once asked; a check that answers says when and that it is up to date (M9 fix 242)', async () => {
  const { fake, updater } = setup();
  fake.emit('checking-for-update');
  fake.emit('error', new Error('Cannot parse update info from latest.yml'));
  assert.equal(updater.state().phase, 'idle');
  assert.equal(updater.state().message, null);
  await updater.act();
  fake.emit('error', new Error('Cannot parse update info from latest.yml'));
  assert.equal(updater.state().phase, 'error');
  assert.equal(updater.state().message, 'Cannot parse update info from latest.yml');
  await updater.act();
  fake.emit('update-not-available', { version: '0.1.228' });
  assert.equal(updater.state().phase, 'idle');
  assert.equal(updater.state().message, 'checked 18:43, up to date');
  fake.emit('update-available', { version: '0.1.100' });
  assert.equal(updater.state().message, 'checked 18:43, up to date');
  // A build ahead clears the outcome and downloads on its own (M9 fix 625).
  fake.emit('update-available', { version: '0.1.240' });
  assert.equal(updater.state().phase, 'downloading');
  assert.equal(updater.state().message, null);
});

test('the download runs on its own, ready follows, and the one click marks the install, posts its word and stops the daemon before the install (M9 fix 625, M9 fix 282, M9 fix 323)', async () => {
  const { fake, updater, order } = setup();
  fake.emit('update-available', { version: '0.1.240' });
  assert.equal(updater.state().phase, 'downloading');
  assert.equal(updater.state().percent, null);
  fake.emit('download-progress', { percent: 42.7 });
  assert.equal(updater.state().percent, 42);
  fake.emit('update-downloaded', { version: '0.1.240' });
  await new Promise((r) => setImmediate(r));
  assert.equal(updater.state().phase, 'ready');
  assert.deepEqual(fake.calls, ['download']);
  // A later check while ready changes nothing.
  fake.emit('update-available', { version: '0.1.240' });
  assert.equal(updater.state().phase, 'ready');

  await updater.act();
  assert.equal(updater.state().phase, 'installing');
  // The marker and the word land before the daemon stop, so a launch in
  // the gap reads them whatever the stop does; the word goes through the
  // poster (M9 fix 323), never the app's own notifier.
  assert.deepEqual(order, ['marked 0.1.240', 'posted 0.1.240', 'daemon stopped']);
  assert.deepEqual(fake.calls, ['download', 'install true true']);
  // A second click while installing does nothing more.
  await updater.act();
  assert.deepEqual(fake.calls, ['download', 'install true true']);
});

test('a differential download that finishes with no progress event stays null rather than a frozen 0% (M9 fix 296)', async () => {
  const { fake, updater } = setup();
  fake.emit('update-available', { version: '0.1.240' });
  assert.equal(updater.state().phase, 'downloading');
  assert.equal(updater.state().percent, null);
  fake.emit('update-downloaded', { version: '0.1.240' });
  assert.equal(updater.state().phase, 'ready');
  assert.equal(updater.state().percent, 100);
});

test('a background download that fails is logged and reads available, with no error shown (M9 fix 625)', async () => {
  const { fake, updater, log } = setup();
  fake.failDownload = new Error('sha512 checksum mismatch');
  fake.emit('update-available', { version: '0.1.240' });
  await new Promise((r) => setImmediate(r));
  assert.equal(updater.state().phase, 'available');
  assert.equal(updater.state().latest, '0.1.240');
  assert.equal(updater.state().message, null);
  assert.deepEqual(fake.calls, ['download']);
  assert.ok(log.includes('updater: the download of 0.1.240 failed on its own: sha512 checksum mismatch; 0.1.240 stays available'), log.join('\n'));
});

test('a clicked retry that fails shows the error, and a click after it checks again (M9 fix 625)', async () => {
  const { fake, updater } = setup();
  fake.failDownload = new Error('sha512 checksum mismatch');
  fake.emit('update-available', { version: '0.1.240' });
  await new Promise((r) => setImmediate(r));
  assert.equal(updater.state().phase, 'available');
  await updater.act();
  assert.equal(updater.state().phase, 'error');
  assert.equal(updater.state().message, 'sha512 checksum mismatch');
  await updater.act();
  assert.deepEqual(fake.calls, ['download', 'download', 'check']);
});

test('start runs the first check after its delay and no check while a download is on', async () => {
  const { fake, updater } = setup();
  updater.start();
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(fake.calls, ['check']);
  fake.emit('update-available', { version: '0.1.240' });
  assert.deepEqual(fake.calls, ['check', 'download']);
  updater.dispose();
});

test('a check runs from ready, nothing newer keeps the downloaded build, and a newer build replaces it (M9 fix 625)', async () => {
  const { fake, updater, log } = setup(undefined, 5);
  updater.start();
  fake.emit('update-available', { version: '0.1.240' });
  fake.emit('update-downloaded', { version: '0.1.240' });
  assert.equal(updater.state().phase, 'ready');
  await new Promise((r) => setTimeout(r, 20));
  const firstDownload = fake.calls.indexOf('download');
  assert.ok(firstDownload >= 0 && fake.calls.indexOf('check', firstDownload) > firstDownload, fake.calls.join(','));
  // The same build again, or nothing newer, leaves ready where it was.
  fake.emit('checking-for-update');
  fake.emit('update-available', { version: '0.1.240' });
  fake.emit('update-not-available', { version: '0.1.228' });
  assert.equal(updater.state().phase, 'ready');
  assert.equal(updater.state().latest, '0.1.240');
  fake.emit('update-available', { version: '0.1.250' });
  assert.equal(updater.state().phase, 'downloading');
  assert.equal(updater.state().latest, '0.1.250');
  assert.equal(fake.calls.filter((c) => c === 'download').length, 2);
  assert.ok(log.includes('updater: 0.1.250 replaces the downloaded 0.1.240'), log.join('\n'));
  fake.emit('update-downloaded', { version: '0.1.250' });
  assert.equal(updater.state().phase, 'ready');
  assert.equal(updater.state().latest, '0.1.250');
  updater.dispose();
});

// Fix 608: the feed a build reads, off the environment, whether it is
// packaged, and whether the local feed folder exists.
function recorder(answer: boolean) {
  const asked: string[] = [];
  return { asked, exists: (p: string) => { asked.push(p); return answer; } };
}

test('the feed spec: off, the override, a dev build, the local feed, then GitHub (fix 608)', () => {
  let r = recorder(true);
  assert.equal(updateFeedSpec({ EMERALD_NO_UPDATE: '1', EMERALD_UPDATE_URL: 'http://127.0.0.1:9/' }, true, r.exists), null);
  assert.deepEqual(r.asked, []);
  r = recorder(true);
  assert.deepEqual(updateFeedSpec({ EMERALD_UPDATE_URL: 'http://127.0.0.1:9/' }, false, r.exists), { provider: 'generic', url: 'http://127.0.0.1:9/' });
  r = recorder(true);
  assert.equal(updateFeedSpec({ EMERALD_UPDATE_URL: '' }, false, r.exists), null);
  r = recorder(true);
  assert.deepEqual(updateFeedSpec({ LOCALAPPDATA: 'C:\\L' }, true, r.exists), { provider: 'generic', url: 'http://127.0.0.1:7420/' });
  assert.deepEqual(r.asked, [path.join('C:\\L', 'emerald-feed')]);
  r = recorder(false);
  assert.deepEqual(updateFeedSpec({ LOCALAPPDATA: 'C:\\L' }, true, r.exists), { provider: 'github', owner: 'zacharykeeton', repo: 'emerald' });
});

const GITHUB: FeedSpec = { provider: 'github', owner: 'zacharykeeton', repo: 'emerald' };

test('on GitHub the spec reaches the updater and the start line names the repository (fix 608)', () => {
  const { fake, updater, log } = setup(GITHUB);
  assert.deepEqual(fake.feed, GITHUB);
  updater.start();
  updater.dispose();
  assert.ok(log.includes('update check against github.com/zacharykeeton/emerald in 0 s and every 4 h'), log.join('\n'));
});

test('on GitHub a repository with no release, missing, private or refusing reads as no feed, asked or not (fix 608)', async () => {
  const messages = [
    'No published versions on GitHub',
    'Unable to find latest version on GitHub (https://github.com/zacharykeeton/emerald/releases/latest), please ensure a production release exists: HttpError: 404 Not Found',
    '404 Not Found\nHeaders: {}',
    '429 Too Many Requests\nHeaders: {}',
    'net::ERR_INTERNET_DISCONNECTED',
  ];
  for (const m of messages) {
    const { fake, updater } = setup(GITHUB);
    fake.emit('checking-for-update');
    fake.emit('error', new Error(m));
    assert.equal(updater.state().phase, 'idle', m);
    assert.equal(updater.state().message, 'no feed at github.com', m);
    await updater.act();
    assert.equal(updater.state().phase, 'checking', m);
    fake.emit('error', new Error(m));
    assert.equal(updater.state().phase, 'idle', m);
    assert.equal(updater.state().message, 'no feed at github.com', m);
  }
});

test('the GitHub messages do not leak to the local feed: a 404 there is a bad answer (fix 608)', async () => {
  assert.equal(isNoFeedError('404 Not Found\nHeaders: {}'), false);
  const { fake, updater } = setup();
  fake.emit('checking-for-update');
  fake.emit('error', new Error('404 Not Found\nHeaders: {}'));
  assert.equal(updater.state().phase, 'idle');
  assert.equal(updater.state().message, null);
  await updater.act();
  fake.emit('error', new Error('404 Not Found\nHeaders: {}'));
  assert.equal(updater.state().phase, 'error');
});

test('a feed lost mid-download is never a badge left downloading: available on its own, an error after a click (fix 608, M9 fix 625)', async () => {
  const { fake, updater } = setup();
  fake.emit('update-available', { version: '0.1.240' });
  assert.equal(updater.state().phase, 'downloading');
  assert.deepEqual(fake.calls, ['download']);
  fake.emit('error', new Error('net::ERR_CONNECTION_REFUSED'));
  assert.equal(updater.state().phase, 'available');
  assert.equal(updater.state().message, null);
  // A clicked retry that loses the feed shows it.
  const p = updater.act();
  assert.equal(updater.state().phase, 'downloading');
  fake.emit('error', new Error('net::ERR_CONNECTION_REFUSED'));
  await p;
  assert.equal(updater.state().phase, 'error');
  assert.equal(updater.state().message, 'net::ERR_CONNECTION_REFUSED');
  assert.deepEqual(fake.calls, ['download', 'download']);
});
