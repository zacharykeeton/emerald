// Fixed-capacity byte ring. Holds the most recent `capacity` bytes of PTY
// output so a client attaching late can be shown what it missed. One Buffer is
// allocated up front and never grows, so a chatty session cannot eat memory.
export class RingBuffer {
  private readonly buf: Buffer;
  // Index of the oldest byte. Only meaningful when length > 0.
  private start = 0;
  private length = 0;
  // Bytes ever written, so a reader can name a point in the stream and ask
  // for what came after it even once the ring has wrapped.
  private total = 0;
  readonly capacity: number;

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new RangeError(`RingBuffer capacity must be a positive integer, got ${capacity}`);
    }
    this.capacity = capacity;
    this.buf = Buffer.allocUnsafe(capacity);
  }

  get size(): number {
    return this.length;
  }

  // The sequence number of the next byte to be written. A reader that
  // remembers it can later ask readSince(seq) for only the new output.
  get seq(): number {
    return this.total;
  }

  write(chunk: Buffer): void {
    if (chunk.length === 0) return;
    this.total += chunk.length;

    // A chunk at least as big as the ring replaces everything; only its tail survives.
    if (chunk.length >= this.capacity) {
      chunk.copy(this.buf, 0, chunk.length - this.capacity);
      this.start = 0;
      this.length = this.capacity;
      return;
    }

    const end = (this.start + this.length) % this.capacity;
    const roomBeforeWrap = this.capacity - end;
    if (chunk.length <= roomBeforeWrap) {
      chunk.copy(this.buf, end);
    } else {
      chunk.copy(this.buf, end, 0, roomBeforeWrap);
      chunk.copy(this.buf, 0, roomBeforeWrap);
    }

    const overflow = this.length + chunk.length - this.capacity;
    if (overflow > 0) {
      // We overwrote the oldest bytes, so advance the start past them.
      this.start = (this.start + overflow) % this.capacity;
      this.length = this.capacity;
    } else {
      this.length += chunk.length;
    }
  }

  // Returns a fresh copy in chronological order. Callers may hold onto it.
  readAll(): Buffer {
    const out = Buffer.allocUnsafe(this.length);
    if (this.length === 0) return out;

    const firstRun = Math.min(this.length, this.capacity - this.start);
    this.buf.copy(out, 0, this.start, this.start + firstRun);
    if (firstRun < this.length) {
      this.buf.copy(out, firstRun, 0, this.length - firstRun);
    }
    return out;
  }

  // The bytes written since sequence number `since`, with `next` to pass in
  // next time. When `since` points before the oldest byte still held, the
  // gap is gone and `oldest` says where what is returned starts.
  readSince(since: number): { data: Buffer; next: number; oldest?: number } {
    const oldest = this.total - this.length;
    if (since < oldest) return { data: this.readAll(), next: this.total, oldest };
    if (since >= this.total) return { data: Buffer.alloc(0), next: this.total };
    return { data: this.readAll().subarray(since - oldest), next: this.total };
  }

  clear(): void {
    this.start = 0;
    this.length = 0;
  }
}
