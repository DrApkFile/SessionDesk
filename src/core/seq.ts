export class SeqAllocator {
  #next: number;

  constructor(start: number) {
    if (!Number.isSafeInteger(start) || start < 1) throw new RangeError(`seq must start at a positive integer, got ${start}`);
    this.#next = start;
  }

  next(): number {
    const allocated = this.#next;
    this.#next += 1;
    return allocated;
  }

  peek(): number {
    return this.#next;
  }
}

export function seqAfterBoot(maxSeqSeen: number): number {
  return Math.max(0, maxSeqSeen) + 1;
}
