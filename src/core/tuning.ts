export const REGULAR_MIN_ACTIVE_DAYS = 3;
export const CONTRIBUTOR_MIN_POINTS = 10;
export const POINTS_PER_CONTRIBUTION = { helped: 2, valid_report: 3 } as const;
export const HELPED_PER_PAIR_PER_DAY = 1;

export const RECALL_LIMIT = 100;
export const NAMESPACE_ROLLOVER_AT = 90;

export const WRITE_TIMEOUT_MS = 60_000;
export const WRITE_ATTEMPTS = 3;
export const WRITE_RETRY_BACKOFF_MS = [2_000, 8_000] as const;

export const BUDGET_WINDOW_MS = 60 * 60 * 1000;
export const BUDGET_POINTS_PER_WINDOW = 500;
export const POINTS_PER_REMEMBER = 5;
export const POINTS_PER_RECALL = 1;

export const PROMISE_MAX_DAYS_AHEAD = 30;
export const FOLLOWUP_CHECK_MINUTES = 30;
export const THEME_WINDOW_DAYS = 7;
export const HELPERS_WINDOW_DAYS = 30;

export const MODEL_ATTEMPTS = 3;
export const MODEL_RETRY_BACKOFF_MS = [1_000, 4_000] as const;

export const MAX_STORED_TEXT_CHARS = 1_000;
export const MAX_THEME_LABEL_CHARS = 40;

export const BUDGET_PAUSE_RECHECK_MS = 60_000;
export const WRITE_PAUSE_LIMIT = 30;
export const NAMESPACE_PAGE_LIMIT = 200;
export const LEDGER_RECALL_QUERY = "SD1 community ledger event";

export const GEMINI_RETRY_WINDOW_MINUTES = 5;
export const PENDING_RETRY_BACKOFF_MS = [15_000, 30_000, 60_000, 120_000, 300_000] as const;
export const PENDING_MAX_ATTEMPTS = 8;
export const PENDING_BUFFER_LIMIT = 200;

export const CONFLICT_BACKOFF_MS = [5_000, 15_000, 30_000, 60_000] as const;
export const POLLING_RESTART_BACKOFF_MS = 10_000;
export const SHUTDOWN_DRAIN_SECONDS = 25;
export const DRAIN_POLL_MS = 500;
export const DEFAULT_PORT = 3000;

export const ANSWER_MAX_DISTANCE = 0.32;
export const ANSWER_SEARCH_LIMIT = 5;
export const KNOWN_ISSUE_MAX_DISTANCE = 0.3;
export const KNOWN_ISSUE_SEARCH_LIMIT = 5;
export const PLAIN_RECALL_TOP_K = 5;

export const ANSWER_FEEDBACK_WINDOW_MINUTES = 30;
