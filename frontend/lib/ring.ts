/** Fixed-capacity FIFO. Oldest items are evicted when full. */
export class RingBuffer<T> {
  private buf: (T | undefined)[];
  private start = 0;
  private len = 0;
  constructor(readonly capacity: number) {
    if (capacity <= 0) throw new Error("capacity must be > 0");
    this.buf = new Array(capacity);
  }
  push(item: T) {
    const idx = (this.start + this.len) % this.capacity;
    this.buf[idx] = item;
    if (this.len < this.capacity) this.len++;
    else this.start = (this.start + 1) % this.capacity;
  }
  get size() {
    return this.len;
  }
  toArray(): T[] {
    const out: T[] = [];
    for (let i = 0; i < this.len; i++) out.push(this.buf[(this.start + i) % this.capacity] as T);
    return out;
  }
  last(): T | undefined {
    return this.len ? this.buf[(this.start + this.len - 1) % this.capacity] : undefined;
  }
  clear() {
    this.buf = new Array(this.capacity);
    this.start = 0;
    this.len = 0;
  }
}
