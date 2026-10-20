// A write another window of the profile made to a localStorage key (M9
// fixes 925 and 926). Every window of a profile shares one localStorage
// and a page reads most keys once, at its load; a module that must follow
// another window's write registers here by key and is handed the new raw
// value, null for a removed key. The writer's own page never hears its own
// write.

export type OtherWrite = (raw: string | null) => void;

const handlers = new Map<string, OtherWrite[]>();

// Touches no window, so a module registers at load and the unit tests
// import it under node.
export function onOtherWindowWrite(key: string, handler: OtherWrite): void {
  const list = handlers.get(key);
  if (list === undefined) handlers.set(key, [handler]);
  else list.push(handler);
}

// The dispatcher, exported for the tests.
export function otherWindowWrote(key: string, raw: string | null): void {
  for (const handler of handlers.get(key) ?? []) handler(raw);
}

export function startOtherWindowWrites(): void {
  window.addEventListener('storage', (ev) => {
    if (ev.key === null || ev.storageArea !== localStorage) return;
    otherWindowWrote(ev.key, ev.newValue);
  });
}
