export const RATE_LIMIT_STATUS = 429;

export function relayerStatus(error: unknown): number | null {
  if (typeof error !== "object" || error === null) return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : null;
}

export function isRateLimited(error: unknown): boolean {
  return relayerStatus(error) === RATE_LIMIT_STATUS;
}

export function retryAfterMs(error: unknown): number | null {
  if (typeof error !== "object" || error === null) return null;
  const seconds = (error as { retryAfterSeconds?: unknown }).retryAfterSeconds;
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) return null;
  return Math.round(seconds * 1000);
}
