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
    message: "I cannot read the community memory right now, so I will not guess what I know about you. Nothing was stored.",
    retryable: true,
    nextAction: "Ask again in a minute.",
  },
  MEMORY_PARTIAL: {
    message: "Some memories could not be read, so this answer may be incomplete.",
    retryable: true,
    nextAction: "Treat the answer as partial and ask again later for the full picture.",
  },
  WRITE_PENDING: {
    message: "This is still being saved to Walrus.",
    retryable: false,
    nextAction: "Check /mydata again in a minute for the blob receipt.",
  },
  WRITE_FAILED: {
    message: "Saving this to Walrus failed after retries, so it is not stored.",
    retryable: true,
    nextAction: "Send the message again, or ask a manager to retry.",
  },
  BUDGET_EXHAUSTED: {
    message: "The hourly Walrus points budget is used up, so nothing was stored.",
    retryable: true,
    nextAction: "Wait for the budget window to roll over.",
  },
  MODEL_UNAVAILABLE: {
    message: "The language model is unavailable, so this reply is a template. Memory was not affected.",
    retryable: true,
    nextAction: "Ask again shortly.",
  },
  MODEL_OUTPUT_REFUSED: {
    message: "I dropped the answer the model wrote because it stated something I have no record of, so you got the plain facts instead. Nothing changed.",
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
    message: "That message looks like it contains a secret, so nothing was stored.",
    retryable: false,
    nextAction: "Rotate the key or token you pasted, then send the message without it.",
  },
  INVALID_TRANSITION: {
    message: "That status change is not allowed from the current status. Nothing changed.",
    retryable: false,
    nextAction: "Check the current status first.",
  },
  UNKNOWN_ITEM: {
    message: "I have no item with that id. Nothing changed.",
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
