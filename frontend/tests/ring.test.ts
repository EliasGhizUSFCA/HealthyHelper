import { describe, expect, it } from "vitest";
import { RingBuffer } from "@/lib/ring";

describe("RingBuffer", () => {
  it("evicts oldest beyond capacity", () => {
    const r = new RingBuffer<number>(3);
    [1, 2, 3, 4, 5].forEach((x) => r.push(x));
    expect(r.toArray()).toEqual([3, 4, 5]);
    expect(r.size).toBe(3);
    expect(r.last()).toBe(5);
    r.clear();
    expect(r.toArray()).toEqual([]);
  });
  it("rejects non-positive capacity", () => {
    expect(() => new RingBuffer(0)).toThrow();
  });
});
