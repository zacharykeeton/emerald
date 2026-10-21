// A daemon error's code carried across the page's invoke (M9 fix 947).
// ipcRenderer.invoke rejects with the message alone, wrapped as `Error
// invoking remote method '<channel>': Error: <message>`, so main puts the
// code and the message into the message as JSON and the preload takes them
// back out. Imports nothing, so node:test runs it.

const MARKER = '{"code":';

export function encodeRequestError(err: unknown): unknown {
  if (!(err instanceof Error)) return err;
  const code = (err as { code?: unknown }).code;
  if (typeof code !== 'string') return err;
  // The key order puts the marker first, which decodeRequestError finds.
  return new Error(JSON.stringify({ code, message: err.message }));
}

export function decodeRequestError(err: unknown): unknown {
  if (!(err instanceof Error)) return err;
  const at = err.message.indexOf(MARKER);
  if (at === -1) return err;
  let parsed: unknown;
  try {
    parsed = JSON.parse(err.message.slice(at));
  } catch {
    return err;
  }
  if (typeof parsed !== 'object' || parsed === null) return err;
  const { code, message } = parsed as { code?: unknown; message?: unknown };
  if (typeof code !== 'string' || typeof message !== 'string') return err;
  return Object.assign(new Error(message), { code });
}
