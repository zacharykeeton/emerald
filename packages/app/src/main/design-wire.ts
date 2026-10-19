// M9 fix 674: Design Mode's grab in the main process. The renderer asks
// for a grab on a browser pane; the picker (design-guest.ts) runs in that
// pane's guest, a click answers the pick, and main takes the crop with
// the overlay hidden, writes it under the home's design folder and hands
// both back. C, S and Escape during a grab are caught on the guest's
// before-input-event, through the rule this module gives index.ts.
import fs from 'node:fs';
import path from 'node:path';
import { ipcMain, type WebContents } from 'electron';
import { formatDesignBlock } from '@emerald/shared';
import type { DesignPick } from '@emerald/shared';
import type { DesignResult } from '../preload/api.ts';
import { DESIGN_CALL, DESIGN_GUEST_SCRIPT, clipRect, grabKey, readPick, shotName } from './design-guest.ts';
import type { GuestVerdict } from './guest-keys.ts';

export interface DesignOptions {
  log: (msg: string) => void;
  // The emerald home; crops go under its design folder.
  home: string;
  // Whether the contents is one of the app's windows (M9 fix 866).
  isWindow: (contents: WebContents) => boolean;
  // The pane's guest, as emmer browser's driver registered it.
  guestFor: (paneId: string) => WebContents | null;
  // A line for the window hosting the guest.
  note: (text: string, guest: WebContents) => void;
  writeText: (text: string) => void;
  writePng: (png: Buffer) => Promise<void>;
}

interface Grab {
  finish: (r: DesignResult) => void;
}

export function wireDesignMode(opts: DesignOptions): { guestRule: (contents: WebContents, input: Electron.Input) => GuestVerdict | null } {
  const grabs = new Map<number, Grab>();
  const call = (guest: WebContents, script: string): Promise<unknown> => guest.executeJavaScript(script, true);

  // The element's box in the viewport, captured with the overlay hidden
  // and shown again after unless the grab is ending anyway.
  const crop = async (guest: WebContents, pick: DesignPick, showAfter: boolean): Promise<Buffer | null> => {
    const rect = clipRect(pick.rect, pick.viewport);
    if (rect === null) return null;
    await call(guest, DESIGN_CALL.hide);
    try {
      await call(guest, DESIGN_CALL.settle);
      const image = await guest.capturePage(rect);
      return image.toPNG();
    } finally {
      if (showAfter && !guest.isDestroyed()) await call(guest, DESIGN_CALL.show).catch(() => {});
    }
  };
  const save = async (png: Buffer): Promise<string> => {
    const dir = path.join(opts.home, 'design');
    await fs.promises.mkdir(dir, { recursive: true });
    const file = path.join(dir, shotName(new Date()));
    await fs.promises.writeFile(file, png);
    return file;
  };
  const shotOf = async (guest: WebContents, pick: DesignPick, showAfter: boolean): Promise<string | null> => {
    try {
      const png = await crop(guest, pick, showAfter);
      if (png === null) {
        opts.log('design: capture failed: the element is off screen');
        return null;
      }
      return await save(png);
    } catch (err) {
      opts.log(`design: capture failed: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  };

  // The pane's guest, when the window asking hosts it.
  const guestOf = (paneId: string, sender: WebContents): WebContents | null => {
    const guest = opts.guestFor(paneId);
    if (guest === null || !opts.isWindow(sender) || guest.getType() !== 'webview' || guest.hostWebContents !== sender) return null;
    return guest;
  };

  ipcMain.handle('emerald:design-start', async (event, paneId: string): Promise<DesignResult> => {
    const guest = guestOf(paneId, event.sender);
    if (guest === null) {
      opts.log(`design: pane ${String(paneId)} refused`);
      return { kind: 'cancel' };
    }
    const id = guest.id;
    grabs.get(id)?.finish({ kind: 'cancel' });
    // Not awaited: the page runs its scripts in the order sent, so this
    // cancel lands before the install below, and the grab is in the map
    // before any design-cancel the renderer sends next can look for it.
    void call(guest, DESIGN_CALL.cancel).catch(() => {});
    return new Promise<DesignResult>((resolve) => {
      let done = false;
      const onNavigate = (details: { isMainFrame: boolean; isSameDocument: boolean }) => {
        if (details.isMainFrame && !details.isSameDocument) grab.finish({ kind: 'cancel' });
      };
      const onDestroyed = () => grab.finish({ kind: 'cancel' });
      const grab: Grab = {
        finish: (r) => {
          if (done) return;
          done = true;
          opts.log(`design: grab on pane ${paneId} ended (${r.kind})`);
          if (grabs.get(id) === grab) grabs.delete(id);
          if (!guest.isDestroyed()) {
            guest.off('did-start-navigation', onNavigate);
            guest.off('destroyed', onDestroyed);
            if (r.kind === 'cancel') void call(guest, DESIGN_CALL.cancel).catch(() => {});
          }
          resolve(r);
        },
      };
      grabs.set(id, grab);
      opts.log(`design: grab on pane ${paneId}`);
      // The script dies with the page, and its promise would never settle.
      guest.on('did-start-navigation', onNavigate);
      guest.once('destroyed', onDestroyed);
      call(guest, DESIGN_GUEST_SCRIPT).then(
        async (value) => {
          if (done) return;
          if (value === null) return grab.finish({ kind: 'cancel' });
          const pick = readPick(value);
          if (pick === null) {
            opts.log('design: the page answered no pick');
            return grab.finish({ kind: 'cancel' });
          }
          const shot = await shotOf(guest, pick, false);
          if (!guest.isDestroyed()) await call(guest, DESIGN_CALL.cancel).catch(() => {});
          grab.finish({ kind: 'pick', pick, shot });
        },
        (err: unknown) => {
          opts.log(`design: the picker failed: ${err instanceof Error ? err.message : String(err)}`);
          grab.finish({ kind: 'cancel' });
        },
      );
    });
  });
  ipcMain.on('emerald:design-cancel', (event, paneId: string) => {
    const guest = guestOf(paneId, event.sender);
    if (guest !== null) grabs.get(guest.id)?.finish({ kind: 'cancel' });
  });

  const act = async (guest: WebContents, key: 'copy' | 'shot'): Promise<void> => {
    const pick = readPick(await call(guest, DESIGN_CALL.hovered));
    if (pick === null) return opts.note('Hover an element first', guest);
    if (key === 'copy') {
      const shot = await shotOf(guest, pick, true);
      opts.writeText(formatDesignBlock([{ id: '', pick, shot, comment: '' }], false));
      return opts.note('Copied the element as markdown', guest);
    }
    let png: Buffer | null = null;
    try {
      png = await crop(guest, pick, true);
    } catch (err) {
      opts.log(`design: capture failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (png === null) return opts.note('Hover an element first', guest);
    await opts.writePng(png);
    opts.note("Copied the element's screenshot", guest);
  };

  // Ahead of the chords: during a grab, C, S and Escape are Design
  // Mode's, kept from the page both down and up, and acted on when down.
  const guestRule = (contents: WebContents, input: Electron.Input): GuestVerdict | null => {
    const grab = grabs.get(contents.id);
    if (grab === undefined) return null;
    const key = grabKey(input);
    if (key === null) return null;
    if (input.type !== 'keyUp') {
      if (key === 'cancel') grab.finish({ kind: 'cancel' });
      else void act(contents, key).catch((err: unknown) => opts.log(`design: ${key} failed: ${err instanceof Error ? err.message : String(err)}`));
    }
    return 'swallow';
  };
  return { guestRule };
}
