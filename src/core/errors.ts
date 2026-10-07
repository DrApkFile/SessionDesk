export const ERROR_CODES = [
  "MEMORY_UNAVAILABLE",
  "MEMORY_PARTIAL",
  "WRITE_PENDING",
  "WRITE_FAILED",
  "BUDGET_EXHAUSTED",
  "MODEL_UNAVAILABLE",
  "MODEL_OUTPUT_REFUSED",
  "NOT_CONSENTED",
  "NOT_MANAGER",
  "SECRET_BLOCKED",
  "INVALID_TRANSITION",
  "UNKNOWN_ITEM",
  "AMBIGUOUS_TARGET",
  "INVALID_DATE",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ErrorInfo {
  readonly message: string;
  readonly retryable: boolean;
  readonly nextAction: string;
}

export const ERRORS = {
  MEMORY_UNAVAILABLE: {
    message: "I cannot reach my memory right now, so I will not guess at what I know about you. Nothing was stored.",
    retryable: true,
    nextAction: "Ask again in a minute.",
  },
  MEMORY_PARTIAL: {
    message: "I could not read some of what I hold, so this answer may be missing something.",
    retryable: true,
    nextAction: "Treat the answer as partial and ask again later for the full picture.",
  },
  WRITE_PENDING: {
    message: "This is still saving.",
    retryable: false,
    nextAction: "Check /mydata again in a minute for the receipt.",
  },
  WRITE_FAILED: {
    message: "I tried several times and could not save this, so it is not saved.",
    retryable: true,
    nextAction: "Send it again, or ask a manager to look.",
  },
  BUDGET_EXHAUSTED: {
    message: "I have hit my hourly saving limit, so nothing was stored just now.",
    retryable: true,
    nextAction: "Try again in a little while.",
  },
  MODEL_UNAVAILABLE: {
    message: "Sorry, my AI is overloaded right now, so I am keeping this short.",
    retryable: true,
    nextAction: "Ask again shortly.",
  },
  MODEL_OUTPUT_REFUSED: {
    message: "I nearly told you something I have no record of, so I am keeping this short instead. Nothing changed.",
    retryable: true,
    nextAction: "Ask again, or ask a manager if a status looks wrong.",
  },
  NOT_CONSENTED: {
    message: "I do not store anything about you until you agree. Nothing was stored.",
    retryable: false,
    nextAction: "Send /start to me in a direct message and press I agree.",
  },
  NOT_MANAGER: {
    message: "This command is for community managers. Nothing changed.",
    retryable: false,
    nextAction: "Ask a manager to run it.",
  },
  SECRET_BLOCKED: {
    message: "That looks like it has something private in it, so nothing was stored.",
    retryable: false,
    nextAction: "Change the key or password you pasted, then send the message without it.",
  },
  INVALID_TRANSITION: {
    message: "That change is not possible from where things stand. Nothing changed.",
    retryable: false,
    nextAction: "Check the current status first.",
  },
  UNKNOWN_ITEM: {
    message: "I do not have that one. Nothing changed.",
    retryable: false,
    nextAction: "Run /themes to see the current item ids.",
  },
  AMBIGUOUS_TARGET: {
    message: "That matches more than one target, so I refused rather than pick one. Nothing changed.",
    retryable: false,
    nextAction: "Name the exact id.",
  },
  INVALID_DATE: {
    message: "That due date is not a future date within the allowed window. Nothing changed.",
    retryable: false,
    nextAction: "Use YYYY-MM-DD within the next 30 days.",
  },
} satisfies Record<ErrorCode, ErrorInfo>;

export function describe(code: ErrorCode): ErrorInfo {
  return ERRORS[code];
}
