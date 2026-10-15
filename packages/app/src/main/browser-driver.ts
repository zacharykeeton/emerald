// M9 fix 672: emmer browser's driver. The daemon pushes browser.requested
// to this main process; the command runs on the pane's guest through its
// webContents.debugger, attached for that command alone, and the answer
// goes back as browser.done. Nothing here calls focus() on anything: the
// input goes to the guest by CDP, and Emulation.setFocusEmulationEnabled
// makes the page act focused while the window's focus stays on the
// person's pane. The renderer says which guest belongs to which pane
// (emerald:browser-guest), since main never sees the pane tree.
import fs from 'node:fs';
import path from 'node:path';
import { ipcMain, webContents, type DownloadItem, type WebContents } from 'electron';
import { browserUrl } from '@emerald/shared';
import type { BrowserAnswer, BrowserVerb, Requests, ServerMessage } from '@emerald/shared';
import { BROWSER_MARK_LINGER_MS, BROWSER_WAIT_POLL_MS, EventLog, centre, downloadName, keySpec, parseRef, pauseFor, screenshotName, snapshotOf, type AxNode, type BrowserEvent, type SnapshotRow } from './browser-drive-model.ts';

// The pane's driven mark, pushed to the window as emerald:browser-drive.
export type DriveState = { by: string; running: boolean; paused: boolean } | null;

export interface DriverClient {
  on(event: 'message', listener: (msg: ServerMessage) => void): unknown;
  request(type: 'browser.done', body: Requests['browser.done']['req']): Promise<unknown>;
}

export interface DriverOptions {
  log: (msg: string) => void;
  // The emerald home; screenshots go under it.
  home: string;
  push: (paneId: string, state: DriveState) => void;
  // The main window's contents, the one sender a guest registration is
  // taken from.
  mainContents: () => WebContents | null;
}

export interface BrowserDriver {
  // The guest showing a pane's page, for Design Mode (fix 674).
  guestFor(paneId: string): WebContents | null;
  // Whether the driver's own input is in flight on this guest, so the
  // window's click-to-focus (fix 670) leaves it alone.
  dispatching(contents: WebContents): boolean;
  // M9 fix 673: a window the page tried to open, for events.
  record(contents: WebContents, entry: BrowserEvent): void;
  // M9 fix 673: a download from a browser partition, saved to the home's
  // downloads folder with no dialog and kept for events.
  download(item: DownloadItem, contents: WebContents | undefined): void;
}

type Requested = Extract<ServerMessage, { type: 'browser.requested' }>;

interface Pane {
  contents: WebContents | null;
  // Full navigations of the main frame since the guest registered.
  navigations: number;
  // The last snapshot's refs and rows, and the navigation count then.
  refs: Map<string, number> | null;
  rows: Map<string, SnapshotRow>;
  refsAt: number;
  // Commands on one pane run one at a time.
  chain: Promise<void>;
  // Raised at each command's start, so the linger clears only its own mark.
  runs: number;
  // M9 fix 673: what the page did since the last events, from the guest's
  // registration; whether a command has driven it, whether the person's
  // click or key paused it, the driver's own dispatches in flight (the
  // person's input is told from them by this), and who drove it last.
  events: EventLog;
  driven: boolean;
  paused: boolean;
  synthetic: number;
  by: string;
}

class Failed extends Error {}
const failed = (text: string): never => {
  throw new Failed(text);
};

export function wireBrowserDriver(client: DriverClient, opts: DriverOptions): BrowserDriver {
  const panes = new Map<string, Pane>();
  const paneOf = (id: string): Pane => {
    let p = panes.get(id);
    if (p === undefined) {
      p = { contents: null, navigations: 0, refs: null, rows: new Map(), refsAt: 0, chain: Promise.resolve(), runs: 0, events: new EventLog(), driven: false, paused: false, synthetic: 0, by: 'emmer' };
      panes.set(id, p);
    }
    return p;
  };
  const paneHolding = (contents: WebContents): [string, Pane] | null => {
    for (const entry of panes) if (entry[1].contents === contents) return entry;
    return null;
  };
  // Listeners go on a guest once, whichever pane holds it now.
  const wired = new WeakSet<WebContents>();

  const register = (paneId: string, contents: WebContents) => {
    // A guest is one pane's: a frame handed to a new pane id (a move,
    // fix 669) takes its state along, the old id left with none.
    const before = paneHolding(contents);
    if (before !== null && before[0] === paneId) return;
    let p: Pane;
    if (before !== null) {
      panes.delete(before[0]);
      p = before[1];
      panes.set(paneId, p);
    } else {
      p = paneOf(paneId);
      p.contents = contents;
      p.navigations = 0;
      p.refs = null;
      p.events = new EventLog();
      p.driven = false;
      p.paused = false;
    }
    if (wired.has(contents)) return;
    wired.add(contents);
    const holder = () => paneHolding(contents);
    contents.on('did-navigate', () => {
      const h = holder();
      if (h !== null) h[1].navigations += 1;
    });
    contents.on('console-message', (e) => {
      if (e.level !== 'error') return;
      holder()?.[1].events.add({ at: Date.now(), kind: 'console', text: e.message, source: e.sourceId, line: e.lineNumber });
    });
    // The takeover (M9 fix 673): the person's press in a driven page.
    const takeover = (input: Parameters<typeof pauseFor>[1]) => {
      const h = holder();
      if (h === null) return;
      const [id, pane] = h;
      const kind = pauseFor(pane, input);
      if (kind === null) return;
      pane.paused = true;
      opts.push(id, { by: pane.by, running: false, paused: true });
      opts.log(`browser: pane ${id.slice(0, 8)} paused by the person's ${kind}`);
    };
    contents.on('before-mouse-event', (_e, m) => takeover({ kind: 'mouse', type: m.type }));
    contents.on('before-input-event', (_e, input) => takeover({ kind: 'key', type: input.type, key: input.key }));
    // A keyDown with no text reaches no before-input-event (verify-m9-
    // browser.mjs's (j3) measured it), so the key is heard here too; a
    // second hearing of one press finds the pane paused already.
    contents.on('input-event', (_e, input) => {
      if (input.type !== 'keyDown' && input.type !== 'rawKeyDown') return;
      takeover({ kind: 'key', type: input.type, key: (input as { keyCode?: string }).keyCode ?? '' });
    });
    contents.once('destroyed', () => {
      const h = holder();
      if (h !== null) h[1].contents = null;
    });
  };

  const resume = (paneId: string, how: string): boolean => {
    const p = panes.get(paneId);
    if (p === undefined || !p.paused) return false;
    p.paused = false;
    const mine = ++p.runs;
    opts.push(paneId, { by: p.by, running: false, paused: false });
    setTimeout(() => {
      if (p.runs === mine && !p.paused) opts.push(paneId, null);
    }, BROWSER_MARK_LINGER_MS);
    opts.log(`browser: pane ${paneId.slice(0, 8)} resumed by ${how}`);
    return true;
  };

  ipcMain.on('emerald:browser-resume', (event, paneId: unknown) => {
    if (typeof paneId !== 'string' || event.sender !== opts.mainContents()) return;
    resume(paneId, 'the Resume button');
  });

  ipcMain.on('emerald:browser-guest', (event, paneId: unknown, id: unknown) => {
    const main = opts.mainContents();
    const guest = typeof id === 'number' ? webContents.fromId(id) : undefined;
    if (typeof paneId !== 'string' || main === null || event.sender !== main || guest === undefined || guest.getType() !== 'webview' || guest.hostWebContents !== main) {
      opts.log(`browser: guest refused for pane ${String(paneId).slice(0, 8)}`);
      return;
    }
    register(paneId, guest);
  });

  client.on('message', (msg) => {
    if (msg.type !== 'browser.requested') return;
    const p = paneOf(msg.paneId);
    p.chain = p.chain.then(() => run(p, msg)).then(
      (answer) => client.request('browser.done', { runId: msg.runId, answer }).then(() => undefined, (err: unknown) => opts.log(`browser: done for run ${msg.runId} failed: ${err instanceof Error ? err.message : String(err)}`)),
      (err: unknown) => opts.log(`browser: run ${msg.runId} threw: ${err instanceof Error ? err.message : String(err)}`),
    );
  });

  async function run(p: Pane, req: Requested): Promise<BrowserAnswer> {
    const short = req.paneId.slice(0, 8);
    // M9 fix 673: reading the page's past is not driving it, so events is
    // answered while paused, and resume is what ends the pause.
    if (req.verb === 'events') {
      const { lines, entries } = p.events.read();
      return { ok: true, text: lines.length === 0 ? 'nothing since the last read' : lines.join('\n'), data: entries };
    }
    if (req.verb === 'resume') {
      return { ok: true, text: resume(req.paneId, 'emmer browser resume') ? 'resumed' : 'was not paused' };
    }
    if (p.paused) return { ok: false, reason: 'paused', text: 'paused by the person; emmer browser resume or the Resume button on the pane' };
    const contents = p.contents;
    if (contents === null || contents.isDestroyed()) {
      return { ok: false, reason: 'failed', text: `pane ${short} has no page yet (its address is empty, or it is still loading)` };
    }
    const started = Date.now();
    const mine = ++p.runs;
    p.driven = true;
    p.by = req.by;
    opts.log(`browser: ${req.verb} on pane ${short} for ${req.by}`);
    opts.push(req.paneId, { by: req.by, running: true, paused: false });
    let answer: BrowserAnswer;
    let attached = false;
    try {
      try {
        contents.debugger.attach('1.3');
        attached = true;
      } catch (err) {
        failed(`could not drive the page: ${err instanceof Error ? err.message : String(err)}`);
      }
      // The driver's own input is counted while in flight (M9 fix 673): the
      // browser process handles the event before the call answers, so the
      // guest's before-* listeners run inside the count and pause nothing.
      const send = async (method: string, params: object = {}) => {
        const own = method.startsWith('Input.');
        if (own) p.synthetic += 1;
        try {
          return (await contents.debugger.sendCommand(method, params)) as Record<string, unknown>;
        } finally {
          if (own) p.synthetic -= 1;
        }
      };
      await send('DOM.enable');
      await send('Accessibility.enable');
      await send('DOM.getDocument', { depth: 0 });
      await send('Emulation.setFocusEmulationEnabled', { enabled: true });
      answer = await withBudget(req, verb(p, contents, send, req));
    } catch (err) {
      answer = err instanceof Failed ? { ok: false, reason: 'failed', text: err.message } : { ok: false, reason: 'failed', text: `the page did not take ${req.verb}: ${err instanceof Error ? err.message : String(err)}` };
    } finally {
      if (attached) {
        try {
          contents.debugger.detach();
        } catch {
          // Gone with the guest, or detached by the page's own close.
        }
      }
    }
    opts.log(`browser: ${req.verb} on pane ${short} answered ${answer.ok ? 'ok' : answer.reason} in ${Date.now() - started} ms`);
    // A pause raised while the command ran keeps its mark.
    if (!p.paused) {
      opts.push(req.paneId, { by: req.by, running: false, paused: false });
      setTimeout(() => {
        if (p.runs === mine && !p.paused) opts.push(req.paneId, null);
      }, BROWSER_MARK_LINGER_MS);
    }
    return answer;
  }

  // The verb under its own budget; wait answers its own words just before.
  function withBudget(req: Requested, work: Promise<BrowserAnswer>): Promise<BrowserAnswer> {
    let timer: NodeJS.Timeout | undefined;
    const spent = new Promise<BrowserAnswer>((resolve) => {
      timer = setTimeout(() => resolve({ ok: false, reason: 'timeout', text: `${req.verb} did not finish within ${Math.round(req.timeoutMs / 1000)} s` }), req.timeoutMs + (req.verb === 'wait' ? 500 : 0));
    });
    // A verb still running past its budget fails on the detach; that late
    // rejection is nobody's.
    work.catch(() => undefined);
    return Promise.race([work, spent]).finally(() => clearTimeout(timer));
  }

  // A ref argument as a backendNodeId, or the words that say why not.
  function resolveRef(p: Pane, arg: string): { id: number; ref: string; row: SnapshotRow | undefined } {
    const ref = parseRef(arg);
    if (ref === null) failed(`${arg} is not a ref; emmer browser snapshot gives refs such as @e1`);
    if (p.refs === null) failed('no snapshot yet; emmer browser snapshot gives the refs');
    if (p.refsAt !== p.navigations) failed(`@${ref} is from before the page changed; take a new snapshot`);
    const id = p.refs!.get(ref!);
    if (id === undefined) failed(`no @${ref} in the last snapshot (${p.refs!.size === 0 ? 'it had none' : `it had @e1 to @e${p.refs!.size}`})`);
    return { id: id!, ref: ref!, row: p.rows.get(ref!) };
  }

  // A key or typed text reaches a guest only while its page holds the
  // window's keyboard: a CDP key event on a guest is routed to the
  // window's focused widget, so with the focus on a shell it lands
  // nowhere in the page (measured in verify:browser-drive's first runs: a
  // fill fell back to the setter and Escape never arrived), and
  // contents.focus() does nothing for a guest. So the pane's page takes
  // the focus in the renderer for the command, which answers whether it
  // holds it, and the renderer's guard (browser-drive-store.ts) hands it
  // back to what held it as soon as the command ends. A page that could
  // not take it refuses the verb rather than type into whatever has the
  // keyboard.
  let focusSeq = 0;
  const focusWaits = new Map<number, (ok: boolean) => void>();
  ipcMain.on('emerald:browser-took-focus', (event, token: unknown, ok: unknown) => {
    if (event.sender !== opts.mainContents() || typeof token !== 'number') return;
    focusWaits.get(token)?.(ok === true);
    focusWaits.delete(token);
  });
  const typeInto = async (paneId: string, verbName: string): Promise<void> => {
    const main = opts.mainContents();
    if (main === null) failed(`no window to give the page the keyboard for ${verbName}`);
    const token = ++focusSeq;
    const ok = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        focusWaits.delete(token);
        resolve(false);
      }, 2000);
      focusWaits.set(token, (v) => {
        clearTimeout(timer);
        resolve(v);
      });
      main!.send('emerald:browser-take-focus', paneId, token);
    });
    if (!ok) failed(`the page could not take the keyboard for ${verbName} (is its layout tab in front?)`);
  };

  const described = (r:{ ref: string; row: SnapshotRow | undefined }) => `@${r.ref}${r.row === undefined ? '' : ` ${r.row.role} ${JSON.stringify(r.row.name)}`}`;

  async function boxCentre(send: (m: string, p?: object) => Promise<Record<string, unknown>>, r: { id: number; ref: string }): Promise<{ x: number; y: number }> {
    try {
      await send('DOM.scrollIntoViewIfNeeded', { backendNodeId: r.id });
      const box = await send('DOM.getBoxModel', { backendNodeId: r.id });
      return centre((box['model'] as { content: number[] }).content);
    } catch {
      return failed(`@${r.ref} has no box on the page (hidden, or gone)`);
    }
  }

  async function verb(p: Pane, contents: WebContents, send: (m: string, p?: object) => Promise<Record<string, unknown>>, req: Requested): Promise<BrowserAnswer> {
    const [a = '', b = ''] = req.args;
    const v: BrowserVerb = req.verb;
    switch (v) {
      case 'snapshot': {
        const tree = await send('Accessibility.getFullAXTree', {});
        const snap = snapshotOf((tree['nodes'] as AxNode[]) ?? [], { title: contents.getTitle(), url: contents.getURL() });
        p.refs = snap.refs;
        p.rows = new Map(snap.rows.map((r) => [r.ref, r]));
        p.refsAt = p.navigations;
        return { ok: true, text: snap.text, data: snap.rows };
      }
      case 'click':
      case 'hover': {
        const r = resolveRef(p, a);
        const { x, y } = await boxCentre(send, r);
        // A click is a press and a release with no move first: in this
        // Electron a synthetic move can take seconds to be acknowledged
        // (cdp.mjs's click says the same), and the press moves the pointer.
        if (v === 'hover') {
          await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
          return { ok: true, text: `hovering over ${described(r)}` };
        }
        await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
        await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
        return { ok: true, text: `clicked ${described(r)}` };
      }
      case 'fill': {
        const r = resolveRef(p, a);
        await typeInto(req.paneId, 'fill');
        await send('DOM.focus', { backendNodeId: r.id });
        const node = await send('DOM.resolveNode', { backendNodeId: r.id });
        const objectId = (node['object'] as { objectId: string }).objectId;
        await send('Runtime.callFunctionOn', { objectId, functionDeclaration: "function () { if (typeof this.select === 'function') this.select(); }" });
        await send('Input.insertText', { text: b });
        const read = await send('Runtime.callFunctionOn', { objectId, functionDeclaration: 'function () { return this.value; }', returnByValue: true });
        let direct = false;
        if ((read['result'] as { value?: unknown }).value !== b) {
          // A field that ignores typed text (a framework's controlled input
          // reset on the next render): the prototype's own setter and the
          // events a framework listens for.
          await send('Runtime.callFunctionOn', {
            objectId,
            functionDeclaration: "function (v) { const d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(this), 'value'); d.set.call(this, v); this.dispatchEvent(new Event('input', { bubbles: true })); this.dispatchEvent(new Event('change', { bubbles: true })); }",
            arguments: [{ value: b }],
          });
          direct = true;
        }
        return { ok: true, text: `filled ${described(r)} with ${b.length} characters${direct ? ' (set directly)' : ''}` };
      }
      case 'key': {
        const spec = keySpec(a);
        if (spec === null) failed(`unknown key ${a}; a letter or digit, or one of Enter, Escape, Tab, Backspace, Delete, Space, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Home, End, PageUp, PageDown, with Ctrl+, Shift+ or Alt+ before it`);
        const { text, ...rest } = spec!;
        await typeInto(req.paneId, 'key');
        // A key with no text goes as the keyboard sends it on Windows, a
        // rawKeyDown (verify-m9-browser.mjs's (j3) measured a keyDown with
        // no text reaching no before-input-event); one with text as a
        // keyDown, which types it.
        await send('Input.dispatchKeyEvent', { type: text === undefined ? 'rawKeyDown' : 'keyDown', ...rest, ...(text === undefined ? {} : { text }) });
        await send('Input.dispatchKeyEvent', { type: 'keyUp', ...rest });
        return { ok: true, text: `pressed ${a}` };
      }
      case 'eval': {
        // userGesture, since without it Chromium marks a history entry the
        // page makes as skippable (GOTCHAS, fixes 645 to 665, item 9).
        const res = await send('Runtime.evaluate', { expression: a, returnByValue: true, awaitPromise: true, userGesture: true });
        const ex = res['exceptionDetails'] as { text?: string; exception?: { description?: string } } | undefined;
        if (ex !== undefined) failed(`the page threw: ${(ex.exception?.description ?? ex.text ?? '').split('\n')[0]}`);
        const value = (res['result'] as { value?: unknown }).value;
        const json = value === undefined ? undefined : JSON.stringify(value);
        return { ok: true, text: json ?? 'undefined', data: value };
      }
      case 'screenshot': {
        const image = await contents.capturePage();
        if (image.isEmpty()) failed('the page has no picture to take (is its layout tab in front?)');
        const dir = path.join(opts.home, 'screenshots');
        fs.mkdirSync(dir, { recursive: true });
        const file = path.join(dir, screenshotName(new Date()));
        fs.writeFileSync(file, image.toPNG());
        return { ok: true, text: file, data: { path: file } };
      }
      case 'wait': {
        const started = Date.now();
        const deadline = started + req.timeoutMs;
        const ref = parseRef(a);
        const r = ref === null ? null : resolveRef(p, a);
        const what = r === null ? JSON.stringify(a) : `@${r.ref}`;
        for (;;) {
          let there = false;
          if (r !== null) {
            there = await send('DOM.getBoxModel', { backendNodeId: r.id }).then(() => true, () => false);
          } else {
            const res = await send('Runtime.evaluate', { expression: `document.body !== null && document.body.innerText.includes(${JSON.stringify(a)})`, returnByValue: true });
            there = (res['result'] as { value?: unknown }).value === true;
          }
          const took = Date.now() - started;
          if (there) return { ok: true, text: r === null ? `${what} is on the page (after ${took} ms)` : `${what} is on screen (after ${took} ms)` };
          if (Date.now() + BROWSER_WAIT_POLL_MS > deadline) return { ok: false, reason: 'timeout', text: `gave up after ${Math.round(req.timeoutMs / 1000)} s waiting for ${what}` };
          await new Promise((resolve) => setTimeout(resolve, BROWSER_WAIT_POLL_MS));
        }
      }
      case 'navigate': {
        if (browserUrl(a) !== a) failed(`not a URL the browser pane opens: ${a}`);
        try {
          await contents.loadURL(a);
        } catch (err) {
          failed(`could not load ${a}: ${err instanceof Error ? err.message : String(err)}`);
        }
        return { ok: true, text: `on ${contents.getURL()}, titled ${JSON.stringify(contents.getTitle())}` };
      }
      case 'upload': {
        const r = resolveRef(p, a);
        try {
          await send('DOM.setFileInputFiles', { files: [b], backendNodeId: r.id });
        } catch {
          failed(`@${r.ref} is not a file input`);
        }
        return { ok: true, text: `set @${r.ref} to ${b}` };
      }
      case 'events':
      case 'resume':
        // Answered in run, before any attach.
        break;
    }
    return failed(`unknown verb ${String(v)}`);
  }

  return {
    guestFor: (paneId) => {
      const c = panes.get(paneId)?.contents ?? null;
      return c === null || c.isDestroyed() ? null : c;
    },
    dispatching: (contents) => (paneHolding(contents)?.[1].synthetic ?? 0) > 0,
    record: (contents, entry) => {
      paneHolding(contents)?.[1].events.add(entry);
    },
    download: (item, contents) => {
      // The path set at once is what keeps Chromium's save dialog away.
      const dir = path.join(opts.home, 'downloads');
      fs.mkdirSync(dir, { recursive: true });
      let taken: string[] = [];
      try {
        taken = fs.readdirSync(dir);
      } catch {
        // A folder just made reads empty.
      }
      const file = path.join(dir, downloadName(taken, item.getFilename()));
      item.setSavePath(file);
      item.once('done', (_e, state) => {
        const pane = contents === undefined ? null : paneHolding(contents);
        if (state === 'completed') {
          opts.log(`browser: download saved to ${file}`);
          pane?.[1].events.add({ at: Date.now(), kind: 'download', path: file });
        } else {
          opts.log(`browser: download ${state}: ${path.basename(file)}`);
          pane?.[1].events.add({ at: Date.now(), kind: 'download-failed', name: path.basename(file), state });
        }
      });
    },
  };
}
