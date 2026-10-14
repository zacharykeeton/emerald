import fsp from 'node:fs/promises';
import path from 'node:path';
import type { SchemeSkin } from '../renderer/src/scheme-model.ts';
import { mergeSchemes, schemeFromWindowsTerminal, schemesFromWindowsTerminal } from '../renderer/src/scheme-model.ts';
import type { TerminalScheme } from '../renderer/src/scheme-model.ts';

// The terminal's colour schemes for the renderer's menu (M9 fix 225).
// Two sources, both read afresh on every call and never written: the
// schemes the app ships, one file each in the Windows Terminal
// colorSchemes shape (packages/app/resources/schemes in a checkout;
// scripts/stage.mjs copies the folder to the stage, so an installed app
// has them under resources/schemes next to app.asar), and the person's
// own Windows Terminal settings.json, whose colorSchemes list holds
// whatever they have added there. EMERALD_WT_SETTINGS names the one file
// to read in place of the usual places, for the verify script.
//
// Every read is async (fs/promises), and the handler is called on every
// pane-menu open, so the reads never sit on the main process's event
// loop: reading %LOCALAPPDATA%\Packages, a folder of hundreds of Store
// apps, with readdirSync stalled the layout under a right click for as
// long as the read took.

export interface SchemeSources {
  shippedDir: string;
  // The settings.json candidates, first hit wins; empty when the
  // environment named one and it is not there.
  settingsFiles: string[];
}

// Where Windows Terminal keeps its settings: the Store package (the
// folder name carries the publisher id, so it is globbed), the Preview
// package beside it, and the unpackaged build's folder.
export async function windowsTerminalSettingsFiles(localAppData: string | undefined, env: NodeJS.ProcessEnv = process.env): Promise<string[]> {
  const named = env['EMERALD_WT_SETTINGS'];
  if (named !== undefined && named !== '') return [named];
  if (localAppData === undefined || localAppData === '') return [];
  const out: string[] = [];
  const packages = path.join(localAppData, 'Packages');
  let names: string[] = [];
  try {
    names = await fsp.readdir(packages);
  } catch {
    // No Store apps folder; the unpackaged path below is still tried.
  }
  // The release package before the Preview, so a person with both gets
  // the one they most likely edit.
  const wt = names.filter((n) => n.startsWith('Microsoft.WindowsTerminal')).sort((a, b) => Number(a.includes('Preview')) - Number(b.includes('Preview')) || a.localeCompare(b));
  for (const n of wt) {
    out.push(path.join(packages, n, 'LocalState', 'settings.json'));
  }
  out.push(path.join(localAppData, 'Microsoft', 'Windows Terminal', 'settings.json'));
  return out;
}

export async function listSchemes(sources: SchemeSources, log: (msg: string) => void, skin: SchemeSkin): Promise<TerminalScheme[]> {
  const shipped: TerminalScheme[] = [];
  let files: string[] = [];
  try {
    files = (await fsp.readdir(sources.shippedDir)).filter((f) => f.endsWith('.json')).sort();
  } catch (err) {
    log(`no shipped schemes at ${sources.shippedDir}: ${String(err)}`);
  }
  for (const f of files) {
    const file = path.join(sources.shippedDir, f);
    try {
      const scheme = schemeFromWindowsTerminal(JSON.parse(await fsp.readFile(file, 'utf8')), 'shipped');
      if (scheme === null) log(`${file} is not a colour scheme`);
      else shipped.push(scheme);
    } catch (err) {
      log(`could not read ${file}: ${String(err)}`);
    }
  }
  let own: TerminalScheme[] = [];
  for (const file of sources.settingsFiles) {
    let text: string;
    try {
      text = await fsp.readFile(file, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') log(`could not read ${file}: ${String(err)}`);
      continue;
    }
    own = schemesFromWindowsTerminal(text);
    break;
  }
  return mergeSchemes(shipped, own, skin);
}
