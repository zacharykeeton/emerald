// The model menu's learned names (M9 fix 1150), kept per profile in the
// renderer's localStorage as a JSON object `{"fable":"Fable 5.3"}`: a
// row of the four family aliases takes the name the status line showed
// after its pick, so a Claude Code update that moves an alias heals the
// row before the next emerald release. Each read and write is in try and
// catch, as ui.ts's preferences are.
import { learnableName, parseModelNames } from './chat-model.ts';

export const MODEL_NAMES_KEY = 'emerald.modelNames';

export function loadModelNames(): Record<string, string> {
  try {
    return parseModelNames(localStorage.getItem(MODEL_NAMES_KEY));
  } catch {
    return {};
  }
}

// A pick overwrites the alias's learned name whatever it was, so a
// rollback is learned too.
export function rememberModelName(alias: string, name: string): Record<string, string> {
  const names = loadModelNames();
  if (!learnableName(alias, name)) return names;
  names[alias] = name;
  try {
    localStorage.setItem(MODEL_NAMES_KEY, JSON.stringify(names));
  } catch {
    // The row just will not learn.
  }
  return names;
}
