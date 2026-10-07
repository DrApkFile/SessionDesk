export interface Clock {
  now(): Date;
}

export interface IdSource {
  newItemId(): string;
  newThemeId(): string;
  newPromiseId(): string;
}

export const systemClock: Clock = { now: () => new Date() };

export function fixedClock(moments: readonly Date[]): Clock {
  let index = 0;
  return {
    now: () => {
      const moment = moments[Math.min(index, moments.length - 1)];
      if (moment === undefined) throw new Error("fixedClock needs at least one moment");
      index += 1;
      return moment;
    },
  };
}

export function countingIds(prefix = ""): IdSource {
  let items = 0;
  let themes = 0;
  let promises = 0;
  return {
    newItemId: () => `${prefix}i${(items += 1)}`,
    newThemeId: () => `${prefix}t${(themes += 1)}`,
    newPromiseId: () => `${prefix}p${(promises += 1)}`,
  };
}

export type Sleep = (ms: number) => Promise<void>;

export const realSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function recordedSleep(record: number[]): Sleep {
  return async (ms) => {
    record.push(ms);
  };
}
