// What every file under commands/ exports as its default.
export interface Command {
  name: string;
  // One line for `emmer help`.
  summary: string;
  // The synopsis, printed on a usage error.
  usage: string;
  // argv after the command name. Returns the exit code, or nothing for 0.
  run(argv: string[]): Promise<number | void>;
}

// Whether anything has been written to stdout or stderr since the process
// started, so main.ts can say so when the command is about to exit 1 in
// silence (M9 fix 379: `emmer new` did once, and nothing named the path).
// The flag is set under both streams' write methods rather than by each
// caller, since a command that writes a screen straight to stdout
// (read.ts) would otherwise be reported as silent after real output.
let wrote = false;

export function watchOutput(): void {
  for (const stream of [process.stdout, process.stderr]) {
    const write = stream.write.bind(stream) as typeof stream.write;
    stream.write = ((...args: Parameters<typeof stream.write>) => {
      wrote = true;
      return write(...args);
    }) as typeof stream.write;
  }
}

export function wroteAnything(): boolean {
  return wrote;
}

// Where the two writers put their text: stdout, or the function a test
// handed captureOutput (M9 fix 375), since a test that swaps
// process.stdout.write under node:test eats the runner's own report.
let sink: (text: string) => void = (text) => {
  process.stdout.write(text);
};

export function println(text: string): void {
  sink(text + '\n');
}

export function printJson(value: unknown): void {
  sink(JSON.stringify(value, null, 2) + '\n');
}

// Routes println and printJson to fn until the returned function is
// called; for tests.
export function captureOutput(fn: (text: string) => void): () => void {
  const before = sink;
  sink = fn;
  return () => {
    sink = before;
  };
}
