import type { ReminderSender } from "../bots/shared/followUpScheduler.js";
import type { PollingSupervisor } from "../bots/shared/polling.js";
import type { Platform } from "./platform.js";

export interface PlatformRuntime {
  readonly platform: Platform;
  readonly supervisors: readonly PollingSupervisor[];
  readonly toManager: ReminderSender;
  readonly toMember: ReminderSender;
  readonly detail: Record<string, string | number | boolean>;
  stop(): Promise<void>;
}

export function runtimeState(runtime: PlatformRuntime): Record<string, string | number | boolean> {
  return {
    platform: runtime.platform,
    polling: runtime.supervisors.every((supervisor) => supervisor.polling()),
    states: runtime.supervisors.map((supervisor) => supervisor.state()).join(","),
    conflicts: runtime.supervisors.reduce((total, supervisor) => total + supervisor.conflicts(), 0),
    ...runtime.detail,
  };
}

export const NO_SENDER: ReminderSender = async () => {
  throw new Error("this platform cannot send direct messages");
};

export interface PlatformPlan {
  readonly platform: Platform;
  readonly enabled: boolean;
  readonly configured: boolean;
  readonly willStart: boolean;
}

export function plannedPlatforms(enabled: Readonly<Record<Platform, boolean>>, configured: Readonly<Record<Platform, boolean>>): readonly PlatformPlan[] {
  return (Object.keys(enabled) as Platform[]).map((platform) => ({
    platform,
    enabled: enabled[platform],
    configured: configured[platform],
    willStart: enabled[platform] && configured[platform],
  }));
}
