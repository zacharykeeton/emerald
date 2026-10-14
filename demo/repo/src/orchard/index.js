// The orchard's feature registry: every module in this folder is a
// feature, found by listing the folder so a new one needs no edit here.
// That is deliberate; parallel demo agents each add a file of their own
// and nothing they touch overlaps.
import { readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));

export async function loadFeatures() {
  const features = [];
  for (const file of readdirSync(here).sort()) {
    if (!file.endsWith('.js') || file === 'index.js') continue;
    const mod = await import(pathToFileURL(path.join(here, file)).href);
    features.push({ file, name: mod.name, run: mod.run });
  }
  return features;
}
