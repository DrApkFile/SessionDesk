import { describe, expect, it } from "vitest";
import { SeqAllocator, seqAfterBoot } from "../../src/core/seq.js";

describe("sequence allocation", () => {
  it("hands out monotonic numbers without repeating", () => {
    const allocator = new SeqAllocator(1);
    expect([allocator.next(), allocator.next(), allocator.next()]).toEqual([1, 2, 3]);
    expect(allocator.peek()).toBe(4);
  });

  it("resumes after the highest sequence seen in walrus at boot", () => {
    expect(seqAfterBoot(41)).toBe(42);
    expect(seqAfterBoot(0)).toBe(1);
    expect(new SeqAllocator(seqAfterBoot(41)).next()).toBe(42);
  });

  it("refuses to start below one", () => {
    expect(() => new SeqAllocator(0)).toThrow(RangeError);
    expect(() => new SeqAllocator(1.5)).toThrow(RangeError);
  });
});
