import { describe, expect, it } from "vitest";
import { Log } from "../../src/bots/shared/log.js";
import { PollingSupervisor, conflictBackoff, isConflict, isUnauthorized, type Pollable } from "../../src/bots/shared/polling.js";
import { CONFLICT_BACKOFF_MS, POLLING_RESTART_BACKOFF_MS } from "../../src/core/tuning.js";

const clock = { now: () => new Date("2026-10-08T09:00:00.000Z") };

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

async function until(condition: () => boolean, ticks = 200): Promise<void> {
  for (let spin = 0; spin < ticks && !condition(); spin += 1) await tick();
}

class Conflicting implements Pollable {
  readonly name = "member";
  starts = 0;
  stops = 0;
  readonly #failures: number;
  readonly #thenRun: boolean;
  #release: (() => void) | null = null;

  constructor(failures: number, thenRun = true) {
    this.#failures = failures;
    this.#thenRun = thenRun;
  }

  async start(onPolling: () => void): Promise<void> {
    this.starts += 1;
    if (this.starts <= this.#failures) throw Object.assign(new Error("Conflict: terminated by other getUpdates request"), { error_code: 409 });
    onPolling();
    if (!this.#thenRun) return;
    await new Promise<void>((resolve) => {
      this.#release = resolve;
    });
  }

  async stop(): Promise<void> {
    this.stops += 1;
    this.#release?.();
    this.#release = null;
  }
}

function supervisorOver(target: Pollable, waits: number[], lines: string[]): PollingSupervisor {
  return new PollingSupervisor(
    target,
    async (ms) => {
      waits.push(ms);
      await tick();
    },
    clock,
    new Log("test", (line) => lines.push(line)),
  );
}

describe("a Telegram 409 Conflict means another instance is polling", () => {
  it("recognises 409 and 401 without depending on the error class", () => {
    expect(isConflict({ error_code: 409 })).toBe(true);
    expect(isConflict({ error_code: 429 })).toBe(false);
    expect(isConflict(new Error("conflict"))).toBe(false);
    expect(isConflict(null)).toBe(false);
    expect(isUnauthorized({ error_code: 401 })).toBe(true);
  });

  it("logs it, backs off and retries until polling starts, never crashing", async () => {
    const waits: number[] = [];
    const lines: string[] = [];
    const target = new Conflicting(3);
    const supervisor = supervisorOver(target, waits, lines);
    const running = supervisor.run();
    await until(() => supervisor.polling());
    expect(target.starts).toBe(4);
    expect(supervisor.conflicts()).toBe(3);
    expect(supervisor.polling()).toBe(true);
    expect(supervisor.state()).toBe("polling");
    expect(waits).toEqual([CONFLICT_BACKOFF_MS[0], CONFLICT_BACKOFF_MS[1], CONFLICT_BACKOFF_MS[2]]);
    expect(lines.join("\n")).toContain("polling_conflict");
    expect(lines.join("\n")).toContain("another instance is polling this token");
    await supervisor.stop();
    await running;
  });

  it("grows the backoff and then holds it steady", () => {
    expect(conflictBackoff(1)).toBe(CONFLICT_BACKOFF_MS[0]);
    expect(conflictBackoff(2)).toBe(CONFLICT_BACKOFF_MS[1]);
    expect(conflictBackoff(99)).toBe(CONFLICT_BACKOFF_MS[CONFLICT_BACKOFF_MS.length - 1]);
    expect(conflictBackoff(0)).toBe(CONFLICT_BACKOFF_MS[0]);
  });

  it("shows conflict_backoff while it waits, so /health can say it is not polling", async () => {
    const waits: number[] = [];
    const lines: string[] = [];
    const supervisor = supervisorOver(new Conflicting(1, false), waits, lines);
    const running = supervisor.run();
    expect(supervisor.state()).toBe("starting");
    expect(supervisor.polling()).toBe(false);
    expect(supervisor.pollingSince()).toBeNull();
    await supervisor.stop();
    await running;
  });

  it("restarts polling if it ends without an error", async () => {
    const waits: number[] = [];
    const supervisor = supervisorOver(new Conflicting(0, false), waits, []);
    const running = supervisor.run();
    await until(() => supervisor.restarts() > 0);
    await supervisor.stop();
    await running;
    expect(waits).toContain(POLLING_RESTART_BACKOFF_MS);
    expect(supervisor.restarts()).toBeGreaterThan(0);
  });

  it("stops retrying on 401, because a wrong token is not going to fix itself", async () => {
    const lines: string[] = [];
    const target: Pollable = {
      name: "member",
      start: async () => {
        throw Object.assign(new Error("Unauthorized"), { error_code: 401 });
      },
      stop: async () => {},
    };
    const supervisor = supervisorOver(target, [], lines);
    await supervisor.run();
    expect(supervisor.state()).toBe("unauthorized");
    expect(lines.join("\n")).toContain("check the bot token; not retrying");
  });

  it("stops cleanly when asked, and stops the bot underneath", async () => {
    const target = new Conflicting(0);
    const supervisor = supervisorOver(target, [], []);
    const running = supervisor.run();
    await until(() => supervisor.polling());
    await supervisor.stop();
    await running;
    expect(target.stops).toBe(1);
    expect(supervisor.state()).toBe("stopped");
    expect(supervisor.polling()).toBe(false);
  });
});
